"use client";
import {motionPreference} from '../lib/motion-preference';
import {useEffect,useRef,type ReactNode} from 'react';

/** Mobile-only scroll choreography; descriptions stay readable without motion/JS. */
export default function ServicesReveal({children}:{children:ReactNode}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const root=ref.current;if(!root)return;
  const mobile=matchMedia('(max-width: 800px)'),reduce=motionPreference();
  const slots=Array.from(root.querySelectorAll<HTMLElement>('.operation-slot'));let frame=0;
  const paint=()=>{frame=0;if(!mobile.matches||reduce.matches)return;
   for(const slot of slots){const p=Math.max(0,Math.min(1,(innerHeight*.72-slot.getBoundingClientRect().top)/(innerHeight*.46))),e=p*p*(3-2*p);slot.style.setProperty('--service-progress',String(e));slot.style.setProperty('--service-lift',`${(1-e)*26}px`);slot.style.setProperty('--service-mask',`${(1-e)*100}%`);slot.style.setProperty('--service-glint',`${-70+e*200}%`);}
  };
  const update=()=>{if(!frame)frame=requestAnimationFrame(paint)};
  const configure=()=>{root.classList.toggle('services-scroll-enabled',mobile.matches&&!reduce.matches);update()};
  configure();mobile.addEventListener('change',configure);reduce.addEventListener('change',configure);window.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);
  return()=>{cancelAnimationFrame(frame);mobile.removeEventListener('change',configure);reduce.removeEventListener('change',configure);window.removeEventListener('scroll',update);window.removeEventListener('resize',update);root.classList.remove('services-scroll-enabled');};
 },[]);
 return <div className="overview-services" ref={ref}>{children}</div>;
}
