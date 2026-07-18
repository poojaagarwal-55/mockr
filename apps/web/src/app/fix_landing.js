const fs = require('fs');

let page = fs.readFileSync('page.tsx', 'utf-8');

// handleLampClick logic rename
page = page.split('const isOn = lampOnRef.current;').join('const goingDark = isDarkRef.current;\n    localStorage.setItem("practers-dark", String(goingDark));');

page = page.split('if (bulbRef.current) gsap.set(bulbRef.current, { attr: { fill: isOn ? BULB_ON_COLOR : "#ffffff" } });').join('if (bulbRef.current) gsap.set(bulbRef.current, { attr: { fill: goingDark ? "#ffffff" : BULB_ON_COLOR } });');

page = page.split('if (glowRef.current) gsap.set(glowRef.current, { opacity: isOn ? 1 : 0 });').join('if (glowRef.current) gsap.set(glowRef.current, { opacity: goingDark ? 0 : 1 });');

page = page.split('triggerTransition(!isOn);').join('triggerTransition(goingDark);');

// `triggerTransition` -> add dark classes to main
page = page.replace('const landing = document.querySelector<HTMLElement>("main");', 'const landing = document.getElementById("landing-page") as HTMLElement | null;');

// Fix dataset toggles
page = page.replace(
  'const d = goingDark;\n    // bg progression:\n    // overall bg matches companies section',
  'const d = goingDark;\n    document.documentElement.dataset.dark = d ? "true" : "";\n    if (landing) landing.dataset.dark = d ? "true" : "";\n    // bg progression:\n    // overall bg matches companies section'
);

fs.writeFileSync('page.tsx', page);
