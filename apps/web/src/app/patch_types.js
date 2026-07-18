const fs = require('fs');
let code = fs.readFileSync('interview-types/page.tsx', 'utf-8');

code = code.replace(/import \{ ForceLight \} from "@\/components\/force-light";\n/, '');

code = code.replace(/const router = useRouter\(\);/g, `const router = useRouter();\n  const [isDark, setIsDark] = useState(false);\n  useEffect(() => {\n    if (typeof window !== 'undefined' && localStorage.getItem('practers-dark') === 'true') {\n      setIsDark(true);\n    }\n  }, []);`);

code = code.replace(/<ForceLight>\s*/, '');
code = code.replace(/<\/ForceLight>\s*/, '');

code = code.replace(
  /className="min-h-screen bg-\\[#f4f5f7\\] text-\\[#1a1a1a\\] antialiased overflow-x-hidden"/,
  'className="min-h-screen antialiased overflow-x-hidden"\n        style={{ backgroundColor: isDark ? "#222222" : "#f4f5f7", color: isDark ? "#eff2f6" : "#1a1a1a", fontFamily: "\'Inter\', sans-serif" }}'
);

code = code.replace(
  /className="bg-white border text-center border-\\[#e8e8e8\\]"/g,
  'className="border text-center border-[#e8e8e8]"\n            style={{ backgroundColor: isDark ? "#303030" : "white", borderColor: isDark ? "#3e3e3e" : "#e8e8e8" }}'
);

code = code.replace(
  /className="bg-white rounded-3xl border border-\\[#e8e8e8\\]/g,
  'className="rounded-3xl border border-[#e8e8e8]"\n            style={{ backgroundColor: isDark ? "#303030" : "white", borderColor: isDark ? "#3e3e3e" : "#e8e8e8" }}'
);

// Navigation link styles
code = code.replace(
  /className="text-\\[15px\\] font-medium tracking-tight text-\\[#333\\] hover:text-\\[#4A7CFF\\] transition-colors"/g,
  'className="text-[15px] font-medium tracking-tight transition-colors hover:text-[#4A7CFF]" style={{ color: isDark ? "#eff2f6" : "#333" }}'
);

// Logo image invert
code = code.replace(
  /className="h-10 w-auto"/g,
  'className="h-10 w-auto" style={{ filter: isDark ? "brightness(0) invert(1)" : "" }}'
);

// Login link
code = code.replace(
  /className="hidden sm:block text-sm text-\\[#1a1a1a\\] px-4 py-2"/g,
  'className="hidden sm:block text-sm px-4 py-2" style={{ color: isDark ? "#eff2f6" : "#1a1a1a" }}'
);

// Get Started link
code = code.replace(
  /className="bg-\\[#1a1a1a\\] text-white text-sm px-5 py-2\.5 rounded-full hover:bg-\\[#333\\] transition-colors"/g,
  'className="text-sm px-5 py-2.5 rounded-full transition-colors" style={{ backgroundColor: isDark ? "#FFE500" : "#1a1a1a", color: isDark ? "#1a1a1a" : "white" }}'
);

code = code.replace(
  /className="text-\\[#555\\] text-lg md:text-xl max-w-2xl mx-auto"/g,
  'className="text-lg md:text-xl max-w-2xl mx-auto" style={{ color: isDark ? "#a8b3cf" : "#555" }}'
);

code = code.replace(
  /className="py-8 bg-white border-t border-\\[#e8e8e8\\]"/g,
  'className="py-8 border-t"\n        style={{ backgroundColor: isDark ? "#222222" : "white", borderColor: isDark ? "#3e3e3e" : "#e8e8e8" }}'
);

fs.writeFileSync('interview-types/page.tsx', code);
