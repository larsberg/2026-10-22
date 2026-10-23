import { instrumentLevel } from './instrument-settings.js';
import { harmonyGateActivity } from './harmony-activity.js';
import { rawGateAt } from './raw-voices.js';

export const musicalPanelKeys = ['keyColor','stripColor','fillColor','rimColor','accentColor','bounceColor','backColor'];
const clamp = value => Math.max(0,Math.min(1,value));

// The same sounding notes, gain, brightness and gate settings that feed the
// instruments feed the lighting envelopes. There is no independent clock.
export function compositionLightCues(pattern, cycle, settings) {
  const parts={bass:0,keys:0,melody:0};let brightness=0;
  if(!(settings.volume>0))return {...parts,brightness:0,gate:0,gateLevel:0};
  for(const hap of pattern.queryArc(cycle,cycle+1e-6)){
    const v=hap.value;
    if(!(v.layer in parts)||!(v.gain>0))continue;
    const gain=v.gain*(settings[v.layer]??0)*instrumentLevel(settings,v.layer)*settings.volume;
    parts[v.layer]+=gain;
    if(gain>0)brightness=Math.max(brightness,v.brightness??.5);
  }
  const gate=harmonyGateActivity(pattern,cycle,settings);
  return {bass:clamp(parts.bass/.38),keys:clamp(parts.keys/.65),melody:clamp(parts.melody/.15),
    brightness:clamp(brightness),gate,gateLevel:gate?rawGateAt(cycle*16,'six',gate):0};
}

export function createMusicalLighting(environment, initial) {
  let settings={...initial},percussion=0,percussionTime=0;
  const fades={},attacks={bass:0,keys:0};
  const levels=Object.fromEntries(musicalPanelKeys.map(key=>[key,settings.musicBuild?settings.buildFloor:1]));
  const apply=()=>environment.setPanelLevels(levels);
  apply();
  return {
    configure(value){
      if(['musicBuild','buildFloor','buildPeak','buildRise','buildFall'].some(key=>settings[key]!==value[key]))
        for(const key of musicalPanelKeys)delete fades[key];
      settings={...value};if(!settings.musicBuild){for(const key of musicalPanelKeys)levels[key]=1;apply();}
    },
    reset(){percussion=percussionTime=0;attacks.bass=attacks.keys=0;for(const key of musicalPanelKeys)delete fades[key];for(const key of musicalPanelKeys)levels[key]=settings.musicBuild?settings.buildFloor:1;apply();},
    update(dt,cues={},events=[]){
      if(!settings.musicBuild||!(dt>0))return false;
      for(const key of Object.keys(attacks))attacks[key]=Math.max(0,attacks[key]-dt);
      // Deliver attacks at their audible scheduler time, once per chord/bass
      // onset. Sustained notes retain a dim bed between these short accents.
      for(const event of events)if(event.layer in attacks)attacks[event.layer]=.18;
      for(const event of events)if(['kick','snare','hat'].includes(event.layer)){
        percussion=clamp((event.gain??.2)*(event.layer==='hat'?.25:.6));percussionTime=.3;
      }
      percussionTime=Math.max(0,percussionTime-dt);if(!percussionTime)percussion=0;
      const {bass=0,keys=0,melody=0,brightness=0,gate=0,gateLevel=gate}=cues;
      const targets={
        keyColor:keys*(attacks.keys>0?1:.08)*(.35+.55*brightness),
        stripColor:gate*gateLevel,
        fillColor:keys*(.15+.6*brightness),
        rimColor:melody*(.45+.55*brightness),
        accentColor:gate*gateLevel*.35+percussion,
        bounceColor:bass*(attacks.bass>0?1:.05)*(.35+.3*brightness),
        backColor:melody*.65,
      };
      let changed=false;
      for(const key of musicalPanelKeys){
        const target=settings.buildFloor+(settings.buildPeak-settings.buildFloor)*clamp(targets[key]);
        if(!fades[key]||Math.abs(fades[key].target-target)>1e-6)
          fades[key]={target,duration:Math.min(.3,target>levels[key]?settings.buildRise:settings.buildFall)};
        // A bounded slew follows moving gate envelopes without repeatedly
        // restarting an ease curve (which could stall on fast-changing cues).
        const fade=fades[key],step=(settings.buildPeak-settings.buildFloor)*dt/fade.duration;
        const next=levels[key]+Math.sign(target-levels[key])*Math.min(Math.abs(target-levels[key]),step);
        if(Math.abs(next-levels[key])>1e-6){levels[key]=next;changed=true;}
      }
      if(changed)apply();return changed;
    },
    get levels(){return {...levels};},
  };
}
