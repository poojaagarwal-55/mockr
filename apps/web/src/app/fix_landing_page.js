const fs = require('fs');

let page = fs.readFileSync('page.tsx', 'utf-8');

const triggerTransitionString = `  const triggerTransition = useCallback((goingDark: boolean) => {
    const landing = document.getElementById("landing-page") as HTMLElement | null;
    if (!landing) return;

    const d = goingDark;
    // Mark dark mode on html + landing so CSS rules can target hover/open states (e.g. FAQ)
    landing.dataset.dark = d ? "true" : "";
    document.documentElement.dataset.dark = d ? "true" : "";

    // Overall bg matches companies section; section containers and cards step progressively lighter
    const BG_PAGE    = d ? "#222222" : "";
    const BG_SECTION = d ? "#2a2a2a" : "";   // features + roles rounded containers
    const BG_CARD    = d ? "#303030" : "";   // How It Works cards, role popup cards
    const BG_HEADER  = d ? "rgba(34,34,34,0.95)" : "";
    const TEXT_1     = d ? "#eff2f6" : "";
    const TEXT_2     = d ? "#a8b3cf" : "";
    const BORDER     = d ? "#3e3e3e" : "";

    // Page wrapper
    landing.style.backgroundColor = BG_PAGE;
    landing.style.color = TEXT_1;

    // Header
    const header = landing.querySelector<HTMLElement>("header");
    if (header) {
      header.style.backgroundColor = BG_HEADER;
      header.style.borderColor = BORDER;
      // Logo: invert to white in dark mode
      const logo = header.querySelector<HTMLElement>("a img");
      if (logo) logo.style.filter = d ? "brightness(0) invert(1)" : "";
      // Nav links
      header.querySelectorAll<HTMLElement>("nav a").forEach(el => { el.style.color = d ? "#eff2f6" : ""; });
      // Header buttons/links
      const loginBtn = header.querySelector<HTMLElement>("a[href='/login']:not(.get-started-btn)");
      if (loginBtn) loginBtn.style.color = d ? "#eff2f6" : "";
      const getStartedBtn = header.querySelector<HTMLElement>("a[href='/login?tab=signup']");
      if (getStartedBtn) { getStartedBtn.style.backgroundColor = d ? "#FFE500" : ""; getStartedBtn.style.color = d ? "#1a1a1a" : ""; }
    }

    // Sections bg (skip final CTA — keep yellow)
    landing.querySelectorAll<HTMLElement>("section").forEach(s => {
      if (s.classList.contains("bg-[\\\\#FFE500]") || s.style.backgroundColor === "rgb(255, 229, 0)") return;
      s.style.backgroundColor = BG_PAGE;
    });

    // Features section inner rounded container
    const featuresInner = document.getElementById("features-inner");
    if (featuresInner) {
      if (!featuresInner.dataset.lightBg) featuresInner.dataset.lightBg = featuresInner.style.background;
      featuresInner.style.background = d
        ? "linear-gradient(to bottom, #2a2a2a 0%, #2a2a2a 40%, #222222 100%)"
        : (featuresInner.dataset.lightBg || "");
    }

    // Roles/"Everything you need" section inner rounded container
    const rolesInner = document.getElementById("roles-inner");
    if (rolesInner) {
      if (!rolesInner.dataset.lightBg) rolesInner.dataset.lightBg = rolesInner.style.background;
      rolesInner.style.background = d
        ? "linear-gradient(to bottom, #2a2a2a 0%, #2a2a2a 60%, #222222 100%)"
        : (rolesInner.dataset.lightBg || "");
    }

    // Blog section inner container
    const blogInner = landing.querySelector<HTMLElement>("#blog .rounded-3xl");
    if (blogInner) {
      if (!blogInner.dataset.lightBg) blogInner.dataset.lightBg = blogInner.style.background;
      blogInner.style.background = d
        ? "linear-gradient(to bottom, #2a2a2a 0%, #2a2a2a 40%, #222222 100%)"
        : (blogInner.dataset.lightBg || "");
    }

    // Blog card overlay containers
    landing.querySelectorAll<HTMLElement>("#blog .rounded-2xl[style]").forEach(el => {
      if (!el.dataset.lightBg) el.dataset.lightBg = el.style.background || el.style.backgroundColor;
      el.style.background = d ? "linear-gradient(to bottom, #303030 0%, #303030 50%, #2a2a2a 100%)" : (el.dataset.lightBg || "");
    });

    // How It Works step cards
    landing.querySelectorAll<HTMLElement>(".how-step-card").forEach(el => {
      if (!el.dataset.lightBg) el.dataset.lightBg = el.style.background;
      el.style.background = d
        ? "linear-gradient(to bottom, #303030 0%, #303030 45%, #2a2a2a 100%)"
        : (el.dataset.lightBg || "");
    });

    // How It Works icon boxes: keep yellow bg in dark mode (don't change)
    landing.querySelectorAll<HTMLElement>(".how-step-card .bg-[\\\\#FFE500]").forEach(el => {
      // Keep yellow icon box background — no change needed
      el.style.backgroundColor = d ? "#e6cf00" : "";
    });

    // Feature icon boxes: keep light background in dark mode
    landing.querySelectorAll<HTMLElement>(".feature-card .rounded-2xl").forEach(el => {
      el.style.backgroundColor = d ? "#f0efe8" : "";
      el.style.borderColor = d ? "#e0dfd8" : "";
    });

    // bg-white elements (role popup cards etc.) — skip feature icon boxes and step circles
    landing.querySelectorAll<HTMLElement>(".bg-white").forEach(el => {
      if (el.closest(".feature-card") || el.closest(".step-circle") || el.closest(".benefit-circle")) return;
      el.style.backgroundColor = BG_CARD;
      el.style.borderColor = BORDER;
    });

    // Glass cards
    landing.querySelectorAll<HTMLElement>(".glass-card").forEach(el => {
      el.style.background = d ? "rgba(48,48,48,0.85)" : "";
      el.style.borderColor = BORDER;
    });

    // Companies section: same bg as page
    const companiesEl = landing.querySelector<HTMLElement>(".companies-section");
    if (companiesEl) companiesEl.style.backgroundColor = BG_PAGE;

    // Logos with dark/black artwork — invert to white in dark mode
    landing.querySelectorAll<HTMLElement>(".companies-section img").forEach(el => {
      const src = (el).getAttribute("src") || "";
      const needsInvert = src.includes("Amazon") || src.includes("uber") || src.includes("apple");
      if (needsInvert) el.style.filter = d ? "brightness(0) invert(1)" : "";
    });

    // Testimonials section
    const testimonialsSection = landing.querySelector<HTMLElement>("#testimonials");
    if (testimonialsSection) {
      testimonialsSection.style.backgroundColor = BG_PAGE;
      const h2 = testimonialsSection.querySelector<HTMLElement>("h2");
      if (h2) h2.style.color = TEXT_1;
      // Testimonial cards
      testimonialsSection.querySelectorAll<HTMLElement>(".bg-white.rounded-[2\\\\.5rem]").forEach(card => {
        card.style.backgroundColor = BG_CARD;
        card.style.borderColor = BORDER;
      });
      testimonialsSection.querySelectorAll<HTMLElement>("p").forEach(el => { el.style.color = TEXT_2; });
    }

    // FAQ: borders + summary inline color (hover/open override handled by CSS !important)
    landing.querySelectorAll<HTMLElement>("details").forEach(el => { el.style.borderColor = BORDER; });
    const faqBorderTop = landing.querySelector<HTMLElement>("#faq .border-t");
    if (faqBorderTop) faqBorderTop.style.borderColor = BORDER;
    landing.querySelectorAll<HTMLElement>("details summary").forEach(el => { el.style.color = d ? "#eff2f6" : ""; });

    // Headings — skip final CTA (yellow bg) and footer
    landing.querySelectorAll<HTMLElement>("h1,h2,h3,h4").forEach(el => {
      if (el.closest("section.bg-[\\\\#FFE500]") || el.closest("footer")) return;
      if (el.closest(".how-step-card") || el.closest(".benefit-card")) { el.style.color = d ? "#4A7CFF" : ""; return; }
      el.style.color = TEXT_1;
    });

    // "Features" section h2 → blue in dark mode
    const featuresH2 = document.querySelector<HTMLElement>("#features h2");
    if (featuresH2) featuresH2.style.color = d ? "#4A7CFF" : "";

    // Specific text colors (skip ones with blue text or white text overrides)
    landing.querySelectorAll<HTMLElement>("p, span, li, a").forEach(el => {
      if (el.closest("header") || el.closest("footer") || el.closest("section.bg-[\\\\#FFE500]")) return;
      if (el.classList.contains("text-[#4A7CFF]") || el.classList.contains("text-white") || el.classList.contains("bg-[#FFE500]")) return;
      if (el.closest(".how-step-card") || el.closest(".benefit-card")) { el.style.color = d ? TEXT_2 : ""; return; }
      el.style.color = d ? TEXT_2 : "";
    });
  }, []);

`;

// Find where to append triggerTransition. Before handleLampClick.
if (!page.includes("const triggerTransition = useCallback((goingDark: boolean) => {")) {
  const insertPos = page.indexOf('const handleLampClick = useCallback(() => {');
  page = page.substring(0, insertPos) + triggerTransitionString + page.substring(insertPos);
}

// Ensure handleLampClick works 
const oldHandleLamp = `  const handleLampClick = useCallback(() => {
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

if(!page.includes('triggerTransition(goingDark);')) {
  // Try to repair if missing
  page = page.replace(/const handleLampClick = useCallback\(\(\) => \{.+?\[playClickSound, BULB_ON_COLOR\]\);/s, oldHandleLamp);
}

// LocalStorage in useGSAP
const gsapLocalStorage = `      // ── Restore dark mode from localStorage ──
      if (typeof window !== "undefined" && localStorage.getItem("practers-dark") === "true") {
        isDarkRef.current = true;
        document.documentElement.dataset.dark = "true";
        triggerTransition(true);
        if (bulbRef.current) gsap.set(bulbRef.current, { attr: { fill: "#ffffff" } });
        if (glowRef.current) gsap.set(glowRef.current, { opacity: 0 });
      }`;

if (!page.includes("localStorage.getItem(\"practers-dark\")") && page.includes('// Set initial colors based on standard Light mode')) {
  page = page.split('// Set initial colors based on standard Light mode (lamp ON)').join(gsapLocalStorage + '\n\n      // Set initial colors based on standard Light mode (lamp ON)');
}

// Update IDs
page = page.split('className="bg-[#f4f5f7] text-[#1a1a1a] antialiased overflow-x-hidden w-full"').join('id="landing-page" className="bg-[#f4f5f7] text-[#1a1a1a] antialiased overflow-x-hidden w-full"');
page = page.split('const featuresInner = document.getElementById("features-inner");').join(''); // Avoid dupe
page = page.replace('<div className="bg-[#f0efe8]', '<div id="features-inner" className="bg-[#f0efe8]');
page = page.replace('<div className="bg-white rounded-[2.5rem]', '<div id="roles-inner" className="bg-white rounded-[2.5rem]');

// Hide lamp
page = page.replace('className="hero-lamp absolute -top-[160px] md:-top-[210px] right-[40%] w-[22%] h-auto z-20 cursor-pointer"', 'className="hero-lamp absolute -top-[160px] md:-top-[210px] right-[40%] w-[22%] h-auto z-20 cursor-pointer hidden lg:block"');

// ForceLight removed from page? (Just in case it returned in dev checkout)
page = page.replace(/<ForceLight>/g, '');
page = page.replace(/<\/ForceLight>/g, '');

fs.writeFileSync('page.tsx', page);
console.log("Rewrote functions successfully.");
