(function(){"use strict";var b=document.querySelector(".hero-landschaft");if(!b)return;var rm=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
var cn=navigator.connection||{};if(rm||cn.saveData||/(^|-)2g$/.test(cn.effectiveType||""))return;
var img=b.querySelector("img"),sv=b.querySelector(".anfahrt"),pf=b.querySelector(".anfahrt path"),t=0;
function par(){t=0;var r=b.getBoundingClientRect(),h=window.innerHeight;if(r.bottom<0||r.top>h)return;var p=(r.top+r.height/2-h/2)/h;p=Math.max(-1,Math.min(1,p));var v="translate3d(0,"+(p*8).toFixed(2)+"px,0)";img.style.transform=v;if(sv)sv.style.transform=v}
/* Parallax nur mit Zeigegeraet: auf Touch (hover:none) aus (animations-regeln-08-11) */
if(!window.matchMedia("(hover: none)").matches){window.addEventListener("scroll",function(){if(!t)t=requestAnimationFrame(par)},{passive:true});par()}
/* Begruendete Einmal-Ausnahme von "nur transform/opacity": die Anfahrtslinie wird genau einmal gezeichnet (stroke-dashoffset, ein kleines SVG, 1100 ms, nur ohne Reduced-Motion/saveData/2g, kein Layout) */
if(pf&&"IntersectionObserver"in window&&pf.animate){var io=new IntersectionObserver(function(e){if(e[0].isIntersecting){io.disconnect();pf.animate([{strokeDashoffset:1},{strokeDashoffset:0}],{duration:1100,easing:"cubic-bezier(.2,.8,.2,1)"})}},{threshold:.35});io.observe(b)}
var rows=document.querySelectorAll(".hero-panel .termin-row");Array.prototype.forEach.call(rows,function(r,i){if(r.animate)r.animate([{transform:"translateY(14px)"},{transform:"none"}],{duration:240,delay:Math.min(i,4)*30,easing:"cubic-bezier(.2,.8,.2,1)",fill:"backwards"})})})();
