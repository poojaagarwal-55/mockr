const fs = require('fs');

let page = fs.readFileSync('page.tsx', 'utf-8');

page = page.replace('const lampOnRef = useRef(true);', 'const isDarkRef = useRef(false);');

// Replacing handleLampClick
page = page.split('lampOnRef.current = !lampOnRef.current;').join('isDarkRef.current = !isDarkRef.current;');
page = page.split('const goingDark = !lampOnRef.current;').join('const goingDark = isDarkRef.current;\n    localStorage.setItem("practers-dark", String(goingDark));');

page = page.replace(
  'const landing = document.querySelector<HTMLElement>("main");',
  'const landing = document.getElementById("landing-page") as HTMLElement | null;'
);

// Add id="landing-page" to the main div
page = page.replace(
  'className="bg-[#f4f5f7] text-[#1a1a1a] antialiased overflow-x-hidden w-full"',
  'id="landing-page" className="bg-[#f4f5f7] text-[#1a1a1a] antialiased overflow-x-hidden w-full"'
);

// triggerTransition changes
const triggerBlockOld = `
    // How It Works icon boxes
    landing.querySelectorAll<HTMLElement>(".how-step-card .bg-\\[\\\\#FFE500\\]").forEach(el => {
      el.style.backgroundColor = d ? "#3e3e3e" : "";
    });`;

const triggerBlockNew = `
    // How It Works icon boxes: keep yellow bg in dark mode
    landing.querySelectorAll<HTMLElement>(".how-step-card .bg-\\[\\\\#FFE500\\]").forEach(el => {
      el.style.backgroundColor = d ? "#e6cf00" : "";
    });`;

page = page.replace(triggerBlockOld, triggerBlockNew);

// Restore hook
const useEffectOld = `
      // Set initial colors based on standard Light mode (lamp ON)
      if (bulbRef.current) gsap.set(bulbRef.current, { attr: { fill: BULB_ON_COLOR } });
      if (glowRef.current) gsap.set(glowRef.current, { opacity: 1 });
`;
const useEffectNew = `
      // Set initial colors based on standard Light mode (lamp ON)
      if (bulbRef.current) gsap.set(bulbRef.current, { attr: { fill: BULB_ON_COLOR } });
      if (glowRef.current) gsap.set(glowRef.current, { opacity: 1 });

      if (typeof window !== "undefined" && localStorage.getItem("practers-dark") === "true") {
        isDarkRef.current = true;
        document.documentElement.dataset.dark = "true";
        triggerTransition(true);
        if (bulbRef.current) gsap.set(bulbRef.current, { attr: { fill: "#ffffff" } });
        if (glowRef.current) gsap.set(glowRef.current, { opacity: 0 });
      }
`;
page = page.replace(useEffectOld, useEffectNew);

fs.writeFileSync('page.tsx', page);
console.log("Landing page patched");
