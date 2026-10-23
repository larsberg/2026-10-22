import argparse, json, pathlib
parser=argparse.ArgumentParser(description='Analyze the supplied music mix locally; no audio is uploaded or played.')
parser.add_argument('input',type=pathlib.Path)
parser.add_argument('--output',type=pathlib.Path,default=pathlib.Path('analysis-output'))
args=parser.parse_args()
import numpy as np
import scipy.signal as sig
from scipy.ndimage import median_filter
import librosa
import soundfile as sf
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
out=args.output;out.mkdir(parents=True,exist_ok=True)
y,sr=librosa.load(args.input,sr=22050,mono=True);hop=1024;nfft=8192
print('loaded',len(y)/sr,flush=True)
D=librosa.stft(y,n_fft=nfft,hop_length=hop)
H,P=librosa.decompose.hpss(D,kernel_size=31,margin=2)
M=np.abs(D);harm=np.abs(H);perc=np.abs(P);times=librosa.frames_to_time(np.arange(M.shape[1]),sr=sr,hop_length=hop)
freqs=librosa.fft_frequencies(sr=sr,n_fft=nfft)
power=M**2
rms=librosa.feature.rms(y=y,frame_length=nfft,hop_length=hop)[0];centroid=np.sum(freqs[:,None]*M,axis=0)/np.maximum(M.sum(axis=0),1e-9)
bands={k:np.sqrt(np.mean(power[(freqs>=lo)&(freqs<hi)],axis=0)) for k,lo,hi in [('bass',30,180),('middle',180,2500),('treble',2500,10000)]}
onset=librosa.onset.onset_strength(S=librosa.amplitude_to_db(perc+1e-8),sr=sr,hop_length=hop)
ac=librosa.autocorrelate(onset,max_size=int(3*sr/hop));lags=np.arange(1,len(ac));bpms=60*sr/hop/lags
peaks,_=sig.find_peaks(ac[1:]);order=sorted([i for i in peaks if 55<bpms[i]<200],key=lambda i:ac[i+1],reverse=True)[:12]
candidates=[{'bpm':round(float(bpms[i]),3),'score':round(float(ac[i+1]/ac[0]),3)} for i in order]
tempo,beats=librosa.beat.beat_track(onset_envelope=onset,sr=sr,hop_length=hop,start_bpm=110,tightness=100)
beat_times=librosa.frames_to_time(beats,sr=sr,hop_length=hop)
chroma=librosa.feature.chroma_stft(S=harm**2,sr=sr,n_fft=nfft,hop_length=hop,tuning=0)
pcs=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
profiles={'major':np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88]),'minor':np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])}
mean=chroma.mean(axis=1)
keys=sorted([{'key':pcs[r]+' '+mode,'correlation':round(float(np.corrcoef(mean,np.roll(p,r))[0,1]),3)} for mode,p in profiles.items() for r in range(12)],key=lambda v:-v['correlation'])
# Interpolated harmonic peaks in the low register; these are candidates, not separated bass stems.
pitches,magnitudes=librosa.piptrack(S=harm,sr=sr,n_fft=nfft,hop_length=hop,fmin=35,fmax=260,threshold=.2)
ids=magnitudes.argmax(axis=0);bass_hz=pitches[ids,np.arange(len(ids))];strength=magnitudes[ids,np.arange(len(ids))]
midi=np.rint(librosa.hz_to_midi(np.maximum(bass_hz,1))).astype(int);midi=median_filter(midi,size=5)
segments=[]
for start in np.arange(0,len(y)/sr,8):
 mask=(times>=start)&(times<start+8);c=chroma[:,mask].mean(axis=1);order=np.argsort(c)[::-1][:5]
 b=midi[mask&(strength>np.percentile(strength,25))];notes,counts=np.unique(b,return_counts=True);orderb=np.argsort(counts)[::-1][:5]
 segments.append({'start':round(float(start),2),'rms_dbfs':round(float(20*np.log10(np.mean(rms[mask])+1e-9)),2),'pitch_classes':[{pcs[i]:round(float(c[i]/c.max()),3)} for i in order], 'bass_candidates':[{librosa.midi_to_note(int(notes[i]),unicode=False):int(counts[i])} for i in orderb]})
# Long stable low-register runs, to distinguish ostinato roots from passing notes.
runs=[];start=0
for i in range(1,len(midi)+1):
 if i==len(midi) or midi[i]!=midi[start]:
  duration=(i-start)*hop/sr
  if duration>=.16 and 28<=midi[start]<=65:runs.append({'time':round(float(times[start]),3),'duration':round(duration,3),'note':librosa.midi_to_note(int(midi[start]),unicode=False)})
  start=i
features=np.vstack([np.log1p(rms),np.log1p(centroid),*[np.log1p(v) for v in bands.values()],chroma])
features=(features-features.mean(axis=1,keepdims=True))/(features.std(axis=1,keepdims=True)+1e-6)
w=int(5*sr/hop);nov=np.zeros(len(times))
for i in range(w,len(times)-w):nov[i]=np.linalg.norm(features[:,i:i+w].mean(axis=1)-features[:,i-w:i].mean(axis=1))
pk,_=sig.find_peaks(nov,distance=int(10*sr/hop),prominence=.3)
changes=sorted([{'time':round(float(times[i]),2),'novelty':round(float(nov[i]),2)} for i in sorted(pk,key=lambda i:-nov[i])[:16]],key=lambda v:v['time'])
report={'duration_seconds':len(y)/sr,'sample_rate':sr,'analysis':'spectral feature estimates of a stereo mix; not isolated instrument stems or an ear-verified transcription','tempo_estimate':float(np.asarray(tempo).flat[0]),'fitted_bpm':float(60/np.polyfit(np.arange(len(beat_times)),beat_times,1)[0]),'tempo_candidates':candidates,'beat_times':beat_times.tolist(),'key_candidates':keys[:8],'pitch_class_strength':{pcs[i]:round(float(mean[i]),3) for i in range(12)},'segments_8s':segments,'stable_low_register_runs':runs,'structural_change_candidates':changes}
(out/'features.json').write_text(json.dumps(report,indent=2))
np.savez_compressed(out/'features.npz',times=times,rms=rms,chroma=chroma,onset=onset,beats=beat_times,bass_midi=midi,centroid=centroid,bass=bands['bass'],middle=bands['middle'],treble=bands['treble'])
fig,ax=plt.subplots(4,1,figsize=(15,10),sharex=True)
ax[0].plot(np.arange(0,len(y),220)/sr,y[::220],lw=.3,color='#586c94');ax[0].set_ylabel('Waveform')
for name,data in bands.items():ax[1].plot(times,10*np.log10(data+1e-6),label=name,lw=.8)
ax[1].legend(loc='upper right');ax[1].set_ylabel('Band energy (relative dB)')
ax[2].imshow(chroma,aspect='auto',origin='lower',extent=[0,len(y)/sr,-.5,11.5],cmap='magma');ax[2].set_yticks(range(12),pcs);ax[2].set_ylabel('Pitch classes')
ax[3].scatter(times,midi,s=1,c=strength,cmap='viridis');ax[3].set_ylim(28,65);ax[3].set_yticks(range(28,66,4),[librosa.midi_to_note(i,unicode=False) for i in range(28,66,4)]);ax[3].set_ylabel('Low-register candidates');ax[3].set_xlabel('Seconds')
for a in ax:
 for c in changes:a.axvline(c['time'],alpha=.15,color='black')
fig.suptitle('SUUNS — Look No Further · analysis of supplied MP3');fig.tight_layout();fig.savefig(out/'overview.png',dpi=140)
print(json.dumps({k:v for k,v in report.items() if k not in ['beat_times','stable_low_register_runs']},indent=2),flush=True)
