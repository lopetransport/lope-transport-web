'use client';
import {motionPreference} from '../lib/motion-preference';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowDown,ArrowUpRight} from 'lucide-react';
import {lopeSocials} from '../lib/social-links';

function RollingName({name}:{name:string}){return <span className="social-word" aria-hidden="true">{Array.from(name.toUpperCase()).map((letter,i)=><span className="social-letter" key={i} style={{transitionDelay:`${i*.022}s`}}>{letter}</span>)}</span>}

export default function SocialTransition({children}:{children:ReactNode}){
 const ref=useRef<HTMLElement>(null),stage=useRef<HTMLDivElement>(null);
 const [enhanced,setEnhanced]=useState(false),[active,setActive]=useState(false);
 useEffect(()=>{
  const node=ref.current,panel=stage.current;if(!node||!panel)return;
  const preference=motionPreference();let frame=0,headerHeight=73,panelHeight=430,distance=1;
  const measure=()=>{headerHeight=document.querySelector<HTMLElement>('.header')?.offsetHeight||73;panelHeight=panel!.offsetHeight;distance=Math.max(1,node!.offsetHeight-panelHeight)};
  function paint(){frame=0;if(preference.matches)return;const available=Math.max(0,(innerHeight-panelHeight)/2);const top=Math.max(headerHeight+16,available);node!.style.setProperty('--social-top',`${top}px`);const progress=Math.max(0,Math.min(1,(top-node!.getBoundingClientRect().top)/Math.max(1,distance)));const t=Math.max(0,Math.min(1,(progress-.16)/.64)),ease=t*t*(3-2*t);node!.style.setProperty('--social-cut',`${100-ease*200}%`);node!.style.setProperty('--social-red-opacity',String(1-ease));node!.style.setProperty('--social-panel-scale',String(1.035-ease*.035));node!.style.setProperty('--social-copy-opacity',String(Math.max(0,Math.min(1,(ease-.35)/.5))));setActive(ease>.55)}
  const update=()=>{if(!frame)frame=requestAnimationFrame(paint)};
  const configure=()=>{setEnhanced(!preference.matches);if(preference.matches){setActive(false);return}update()};
  configure();window.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);preference.addEventListener('change',configure);
  const resize=new ResizeObserver(()=>{measure();update()});resize.observe(panel);resize.observe(node);measure();update();
  return()=>{cancelAnimationFrame(frame);resize.disconnect();window.removeEventListener('scroll',update);window.removeEventListener('resize',update);preference.removeEventListener('change',configure)};
 },[]);
 return <section ref={ref} className={'social-story'+(enhanced?' social-enhanced':'')} aria-label="Start a conversation and follow Lope">
  <div ref={stage} className="social-stage">
   <div className="social-red-panel" inert={enhanced&&active} aria-hidden={enhanced&&active}>{children}<span className="social-next-cue" aria-hidden="true">KEEP IN TOUCH <ArrowDown size={12}/></span></div>
   <section className={'social-panel'+(active?' is-current':'')} aria-labelledby="social-heading" inert={enhanced&&!active} aria-hidden={enhanced&&!active}>
    <div className="social-glass-shell" aria-hidden="true"/><span className="social-panel-kicker">LOPE / BEYOND THE DELIVERY</span>
    <div className="social-panel-copy"><h2 id="social-heading">Follow<br/><em>the movement.</em></h2><p>Stay connected with Lope.</p>
     <nav className="social-links" aria-label="Lope social media">{lopeSocials.map(({name,url})=>url?<a className="social-link" key={name} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Lope on ${name}`}><RollingName name={name}/><ArrowUpRight size={15}/></a>:<span className="social-link social-pending" key={name} aria-label={`${name} — profile link pending confirmation`} title="Profile link pending confirmation"><RollingName name={name}/><ArrowUpRight size={15}/></span>)}</nav>
    </div><div className="social-panel-bottom"><span>FORWARD THINKING. EVERY KILOMETRE.</span><a href="mailto:ops@lopetransport.co.za">ops@lopetransport.co.za <ArrowUpRight size={13}/></a></div>
   </section>
  </div>
 </section>;
}
