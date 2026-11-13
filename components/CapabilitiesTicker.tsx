'use client';
import {useState} from 'react';
import {Truck,Route,MapPin,Package,Award,ShieldCheck,Satellite,Gauge,BrainCircuit,UserRoundCheck,Ship} from 'lucide-react';

const capabilities=[
 {label:'1–34 tonne capacity',Icon:Truck},
 {label:'National freight corridors',Icon:Route},
 {label:'Clayville operating hub',Icon:MapPin},
 {label:'Local to long-haul',Icon:Package},
 {label:'BBBEE Registered',Icon:Award},
 {label:'POPIA Compliant',Icon:ShieldCheck},
 {label:'Fleet Telematics Provider',Icon:Satellite},
 {label:'Service Efficiency Models',Icon:Gauge},
 {label:'AI Analytics',Icon:BrainCircuit},
 {label:'Professional Onboards',Icon:UserRoundCheck},
 {label:'Freight Forwarding',Icon:Ship}
];

export default function CapabilitiesTicker(){
 const [paused,setPaused]=useState(false);
 return <section className="operating-strip capabilities-ticker" aria-label="Lope capabilities and credentials">
  <div className="capabilities-window"><div className="capabilities-track" style={{animationPlayState:paused?'paused':'running'}}>
   {[0,1].map(copy=><ul className="capabilities-group" key={copy} aria-hidden={copy===1?true:undefined}>{capabilities.map(({label,Icon})=><li key={label}><Icon size={18} strokeWidth={1.4} aria-hidden="true"/><span>{label}</span></li>)}</ul>)}
  </div></div>
  <button className="capabilities-toggle" type="button" aria-label={paused?'Resume information strip':'Pause information strip'} title={paused?'Resume information strip':'Pause information strip'} aria-pressed={paused} onClick={()=>setPaused(!paused)}><span className="ticker-sr-label">{paused?'Resume information strip':'Pause information strip'}</span></button>
 </section>;
}
