const fs = require('fs');

let page = fs.readFileSync('page.tsx', 'utf-8');
const handleLampOld = `  const handleLampClick = useCallback(() => {
    // Only allow toggle when lamp is fully stretched (not scrolled)
    if (scrollProgressRef.current >= 0.01) return;
    playClickSound();
    isDarkRef.current = !isDarkRef.current;
    const goingDark = isDarkRef.current;
    localStorage.setItem("practers-dark", String(goingDark));
    if (bulbRef.current) gsap.set(bulbRef.current, { attr: { fill: goingDark ? "#ffffff" : BULB_ON_COLOR } });
    if (glowRef.current) gsap.set(glowRef.current, { opacity: goingDark ? 0 : 1 });
  }, [playClickSound, BULB_ON_COLOR]);`;

const handleLampNew = `  const handleLampClick = useCallback(() => {
    // Only allow toggle when lamp is fully stretched (not scrolled)
    if (scrollProgressRef.current >= 0.01) return;
    playClickSound();
    isDarkRef.current = !isDarkRef.current;
    const goingDark = isDarkRef.current;
    localStorage.setItem("practers-dark", String(goingDark));
    if (bulbRef.current) gsap.set(bulbRef.current, { attr: { fill: goingDark ? "#ffffff" : BULB_ON_COLOR } });
    if (glowRef.current) gsap.set(glowRef.current, { opacity: goingDark ? 0 : 1 });
    triggerTransition(goingDark);
  }, [playClickSound, BULB_ON_COLOR, triggerTransition]);`;

if (page.includes(handleLampOld)) {
  page = page.replace(handleLampOld, handleLampNew);
  console.log("handleLampClick fixed");
} else {
  console.log("Could not find handleLampClick OLD explicitly");
}

fs.writeFileSync('page.tsx', page);
