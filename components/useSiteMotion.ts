'use client';
import {motionPreference} from '../lib/motion-preference';
import {useEffect,type RefObject} from 'react';

/** Progressive enhancement: content remains readable without JavaScript or motion. */
export function useSiteMotion(ref:RefObject<HTMLDivElement|null>,page:string){
 useEffect(()=>{
  const root=ref.current;if(!root)return;
  const preference=motionPreference();
  let teardown=()=>{};
  function setup(){
   teardown();
   if(preference.matches)return;
   const animations=new Set<Animation>();
   const items=Array.from(root!.querySelectorAll<HTMLElement>('.overview-story,.operation-row,.information-grid>article,.section-heading,.fleet-card,.network-copy,.network-map,.industry,.promise>div,.faq-section>div:first-child,.faq,.contact-cta>div,.footer-main>div'));
   const reveal=(element:HTMLElement,index=0)=>{
    if(typeof element.animate!=='function')return;
    const editorial=element.matches('.overview-story,.network-copy,.section-heading');
    const animation=element.animate(editorial?[{opacity:0,transform:'translateY(34px)',clipPath:'inset(0 0 24% 0)'},{opacity:1,transform:'translateY(0)',clipPath:'inset(0 0 0% 0)'}]:[{opacity:0,transform:'translateY(28px)'},{opacity:1,transform:'translateY(0)'}],{duration:editorial?850:680,delay:window.innerWidth>700?(index%3)*85:0,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'});
    animations.add(animation);animation.onfinish=()=>animations.delete(animation);
   };
   // Observe resting geometry. Applying a transform before observing can delay entry.
   const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
     if (!entry.isIntersecting) continue;
     const element = entry.target as HTMLElement;
     observer?.unobserve(element);
     if (!preference.matches) reveal(element, items.indexOf(element));
    }
   }, {threshold: 0}) : undefined;
   for (const element of items) {
    if (element.getBoundingClientRect().top >= window.innerHeight) observer?.observe(element);
   }
   let frame=0;
   const hero=root!.querySelector<HTMLElement>('.hero'),rail=root!.querySelector<HTMLElement>('.movement-rail');
   const stage=root!.querySelector<HTMLElement>('.hero-scroll-stage');
   const finePointer=window.matchMedia('(hover:hover) and (pointer:fine)');
   const paint=()=>{frame=0;root!.toggleAttribute('data-scrolled',window.scrollY>24);const length=document.documentElement.scrollHeight-window.innerHeight;root!.style.setProperty('--reading-progress',String(length>0?Math.min(1,Math.max(0,window.scrollY/length)):0));if(hero){const progress=Math.max(0,Math.min(1,-hero.getBoundingClientRect().top/hero.offsetHeight));hero.style.setProperty('--hero-travel',`${progress*(finePointer.matches?65:24)}px`);hero.style.setProperty('--hero-scale',String(1.045+progress*.045));if(stage&&window.innerWidth<=800){stage.setAttribute('data-sequence','');const box=stage.getBoundingClientRect(),header=root!.querySelector<HTMLElement>('.header')?.offsetHeight||73;const distance=stage.offsetHeight-hero.offsetHeight;const sequence=Math.max(0,Math.min(1,(header-box.top)/Math.max(1,distance)));const smooth=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t)};const pan=smooth(sequence/.5),zoom=smooth((sequence-.32)/.48),width=hero.clientWidth,height=hero.clientHeight,imageWidth=height*(1660/948),endScale=Math.min(1,width*.9/(imageWidth*.56)),scale=1+(endScale-1)*zoom;const startX=-(imageWidth-width)*(.6+pan*.3),endX=width/2-imageWidth*endScale*.68;hero.style.setProperty('--mobile-image-width',`${imageWidth}px`);hero.style.setProperty('--mobile-image-x',`${startX*(1-zoom)+endX*zoom}px`);hero.style.setProperty('--mobile-image-y',`${height*.58*(1-scale)}px`);hero.style.setProperty('--mobile-image-scale',String(scale));hero.style.setProperty('--sequence-progress',String(sequence));hero.style.setProperty('--sequence-copy',String(1-smooth(sequence/.3)));const release=Math.max(0,header-hero.getBoundingClientRect().top),exit=smooth(release/Math.max(1,height));hero.style.setProperty('--hero-exit',String(exit));hero.style.setProperty('--hero-exit-opacity',String(1-exit));hero.style.setProperty('--hero-exit-lift',`${-exit*30}px`);hero.style.setProperty('--hero-exit-scale',String(1-exit*.065));hero.style.setProperty('--hero-exit-radius',`${exit*26}px`)}else{stage?.removeAttribute('data-sequence')}}if(rail){const progress=Math.max(0,Math.min(1,(innerHeight-rail.getBoundingClientRect().top)/(innerHeight*.72)));rail.style.setProperty('--route-progress',String(progress))}};
   let idleTimer:ReturnType<typeof setTimeout>|undefined,heroVisible=false;
   const resumeRoute=()=>{root!.toggleAttribute('data-route-idle',heroVisible&&!document.hidden)};
   const routeObserver=hero&&'IntersectionObserver' in window?new IntersectionObserver(entries=>{heroVisible=entries[0]?.isIntersecting||false;resumeRoute()},{threshold:0}):undefined;
   if(hero)routeObserver?.observe(hero);
   const scroll=()=>{root!.removeAttribute('data-route-idle');clearTimeout(idleTimer);idleTimer=setTimeout(resumeRoute,240);if(!frame)frame=requestAnimationFrame(paint)};
   let hovered:HTMLElement|null=null,pointerFrame=0;
   const resetCard=()=>{if(hovered){hovered.style.removeProperty('--card-x');hovered.style.removeProperty('--card-y');hovered.style.removeProperty('--tilt-x');hovered.style.removeProperty('--tilt-y');hovered.removeAttribute('data-pointer');hovered=null}};
   const pointer=(event:PointerEvent)=>{if(!finePointer.matches)return;const card=(event.target as HTMLElement).closest<HTMLElement>('.action-launch,.fleet-card,.industry');if(card!==hovered){resetCard();hovered=card}if(!card||pointerFrame)return;const x=event.clientX,y=event.clientY;pointerFrame=requestAnimationFrame(()=>{pointerFrame=0;if(hovered!==card)return;const box=card.getBoundingClientRect(),px=Math.max(0,Math.min(1,(x-box.left)/box.width)),py=Math.max(0,Math.min(1,(y-box.top)/box.height));card.style.setProperty('--card-x',`${px*100}%`);card.style.setProperty('--card-y',`${py*100}%`);card.style.setProperty('--tilt-x',`${(0.5-py)*4}deg`);card.style.setProperty('--tilt-y',`${(px-0.5)*4}deg`);card.setAttribute('data-pointer','')})};
   document.addEventListener('visibilitychange',resumeRoute);paint();window.addEventListener('scroll',scroll,{passive:true});window.addEventListener('resize',scroll);root!.addEventListener('pointermove',pointer,{passive:true});root!.addEventListener('pointerleave',resetCard);
   teardown=()=>{clearTimeout(idleTimer);routeObserver?.disconnect();document.removeEventListener('visibilitychange',resumeRoute);root!.removeAttribute('data-route-idle');observer?.disconnect();animations.forEach(animation=>animation.cancel());window.removeEventListener('scroll',scroll);window.removeEventListener('resize',scroll);root!.removeEventListener('pointermove',pointer);root!.removeEventListener('pointerleave',resetCard);cancelAnimationFrame(frame);cancelAnimationFrame(pointerFrame);resetCard();stage?.removeAttribute('data-sequence');for(const name of ['--hero-travel','--hero-scale','--hero-pan','--mobile-image-width','--mobile-image-x','--mobile-image-y','--mobile-image-scale','--sequence-progress','--sequence-copy','--hero-exit','--hero-exit-opacity','--hero-exit-lift','--hero-exit-scale','--hero-exit-radius'])hero?.style.removeProperty(name);rail?.style.removeProperty('--route-progress');root!.removeAttribute('data-scrolled');root!.style.removeProperty('--reading-progress')};
  }
  setup();preference.addEventListener('change',setup);
  return()=>{teardown();preference.removeEventListener('change',setup)};
 },[page,ref]);
}
