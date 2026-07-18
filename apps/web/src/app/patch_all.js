const fs = require('fs');

// ==== FAQ ====
let faq = fs.readFileSync('faq/page.tsx', 'utf-8');

// 1. Remove ForceLight import
faq = faq.replace(/import \{ ForceLight \} from "@\/components\/force-light";\n/, '');

// 2. Add state
faq = faq.replace(
  'const [searchQuery, setSearchQuery] = useState("");',
  'const [searchQuery, setSearchQuery] = useState("");\n  const [isDark, setIsDark] = useState(false);\n\n  useEffect(() => {\n    if (typeof window !== "undefined" && localStorage.getItem("practers-dark") === "true") {\n      setIsDark(true);\n    }\n  }, []);'
);

// 3. Remove ForceLight JSX and replace with <div>
faq = faq.replace('<ForceLight>', '<div className={isDark ? "inner-page-dark text-[#eff2f6]" : "bg-[#f4f5f7] text-[#111]"} style={{ minHeight: "100vh" }}>');
faq = faq.replace('</ForceLight>', '</div>');

// 4. Update header
faq = faq.replace(
  'className="sticky top-0 z-40 w-full bg-[#f4f5f7]/90 backdrop-blur-md border-b border-[#e8e8e8]"',
  'className={`sticky top-0 z-40 w-full backdrop-blur-md border-b ${isDark ? "border-[#3e3e3e] bg-[rgba(34,34,34,0.9)]" : "bg-[#f4f5f7]/90 border-[#e8e8e8]"}`}'
);

// 5. Update main background
faq = faq.replace(
  'className="min-h-screen bg-[#f4f5f7] pb-24"',
  'className={`min-h-screen pb-24 ${isDark ? "inner-page-dark" : "bg-[#f4f5f7]"}`}'
);

// 6. Search Input background
faq = faq.replace(
  'className="w-full bg-white border border-[#cccccc] text-[#111] text-[16px] rounded-full py-3.5 pl-14 pr-6 placeholder:text-[#999] focus:outline-none focus:border-[#4A7CFF] transition-colors hover:border-[#a0a0a0]"',
  'className={`w-full border text-[16px] rounded-full py-3.5 pl-14 pr-6 focus:outline-none focus:border-[#4A7CFF] transition-colors ${isDark ? "bg-[#303030] text-[#eff2f6] border-[#444] placeholder:text-[#777]" : "bg-white text-[#111] border-[#cccccc] placeholder:text-[#999] hover:border-[#a0a0a0]"}`}'
);

// 7. General text colors
faq = faq.replace(
  /className="text-\\[2\.6rem\\] md:text-\\[3\.5rem\\] font-extrabold text-\\[#111\\] tracking-tight"/g,
  'className={`text-[2.6rem] md:text-[3.5rem] font-extrabold tracking-tight ${isDark ? "text-[#eff2f6]" : "text-[#111]"}`}'
);

faq = faq.replace(
  /className="text-\\[22px\\] font-extrabold text-\\[#111\\] mb-6 tracking-tight flex items-center gap-3"/g,
  'className={`text-[22px] font-extrabold mb-6 tracking-tight flex items-center gap-3 ${isDark ? "text-[#eff2f6]" : "text-[#111]"}`}'
);

fs.writeFileSync('faq/page.tsx', faq);


// ==== INTERVIEW TYPES ====
let types = fs.readFileSync('interview-types/page.tsx', 'utf-8');

types = types.replace(/import \{ ForceLight \} from "@\/components\/force-light";\n/, '');

types = types.replace(
  'const router = useRouter();',
  'const router = useRouter();\n  const [isDark, setIsDark] = useState(false);\n\n  useEffect(() => {\n    if (typeof window !== "undefined" && localStorage.getItem("practers-dark") === "true") {\n      setIsDark(true);\n    }\n  }, []);'
);

types = types.replace('<ForceLight>', '');
types = types.replace('</ForceLight>', '');

// The root div
types = types.replace(
  'className="min-h-screen bg-[#f4f5f7] text-[#1a1a1a] antialiased overflow-x-hidden"',
  'className={`min-h-screen antialiased overflow-x-hidden ${isDark ? "inner-page-dark" : "bg-[#f4f5f7] text-[#1a1a1a]"}`}'
);

// bg-white cards inside interview-types
types = types.replace(
  /className="bg-white border text-center border-\\[#e8e8e8\\]"/g,
  'className={`border text-center ${isDark ? "inner-page-dark-card" : "bg-white border-[#e8e8e8]"}`}'
);

types = types.replace(
  /className="bg-white rounded-3xl border border-\\[#e8e8e8\\]"/g,
  'className={`rounded-3xl border ${isDark ? "inner-page-dark-card" : "bg-white border-[#e8e8e8]"}`}'
);

// Update Header background
types = types.replace(
  'className="sticky top-0 z-40 w-full bg-[#f4f5f7]/90 backdrop-blur-md border-b border-[#e8e8e8] transition-transform duration-300"',
  'className={`sticky top-0 z-40 w-full backdrop-blur-md border-b transition-transform duration-300 ${isDark ? "border-[#3e3e3e] bg-[rgba(34,34,34,0.9)]" : "bg-[#f4f5f7]/90 border-[#e8e8e8]"}`}'
);


fs.writeFileSync('interview-types/page.tsx', types);

