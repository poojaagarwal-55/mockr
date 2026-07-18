const fs = require('fs');

let faq = fs.readFileSync('faq/page.tsx', 'utf-8');
faq = faq.replace(/import \{ ForceLight \} from "@\/components\/force-light";\n/, '');
faq = faq.replace(/const \[searchQuery, setSearchQuery\] = useState\(""\);/, `const [searchQuery, setSearchQuery] = useState("");
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("practers-dark") === "true") {
      setIsDark(true);
    }
  }, []);`);
faq = faq.replace(/<ForceLight>\s*/, '');
faq = faq.replace(/<\/ForceLight>\s*/, '');
// Body style
faq = faq.replace(/className="min-h-screen bg-\\[#f4f5f7\\] pb-24"/, 'className="min-h-screen pb-24" style={{ backgroundColor: isDark ? "#222222" : "#f4f5f7", color: isDark ? "#eff2f6" : "#111" }}');
// Header
faq = faq.replace(/className="sticky top-0 z-40 w-full bg-\\[#f4f5f7\\]\/90 backdrop-blur-md border-b border-\\[#e8e8e8\\]"/, 'className="sticky top-0 z-40 w-full backdrop-blur-md border-b"\n        style={{ backgroundColor: isDark ? "rgba(34,34,34,0.9)" : "rgba(244,245,247,0.9)", borderColor: isDark ? "#3e3e3e" : "#e8e8e8" }}');
// Search input
faq = faq.replace(/className="w-full bg-white border border-\\[#cccccc\\] text-\\[#111\\] text-\\[16px\\] rounded-full py-3\.5 pl-14 pr-6 placeholder:text-\\[#999\\] focus:outline-none focus:border-\\[#4A7CFF\\] transition-colors hover:border-\\[#a0a0a0\\]"/, 'className="w-full border text-[16px] rounded-full py-3.5 pl-14 pr-6 placeholder:text-[#999] focus:outline-none focus:border-[#4A7CFF] transition-colors" style={{ backgroundColor: isDark ? "#303030" : "white", borderColor: isDark ? "#444" : "#cccccc", color: isDark ? "#eff2f6" : "#111" }}');
// Details
faq = faq.replace(/className="flex flex-col border-t border-\\[#e8e8e8\\]"/g, 'className="flex flex-col border-t" style={{ borderColor: isDark ? "#3e3e3e" : "#e8e8e8" }}');
faq = faq.replace(/className="group border-b border-\\[#e8e8e8\\] overflow-hidden transition-all duration-200"/g, 'className="group border-b overflow-hidden transition-all duration-200" style={{ borderColor: isDark ? "#3e3e3e" : "#e8e8e8" }}');
faq = faq.replace(/className="cursor-pointer py-5 md:py-6 font-semibold text-\\[16px\\] md:text-\\[17px\\] text-\\[#222\\] transition-colors duration-300 group-hover:text-\\[#4A7CFF\\] group-open:text-\\[#4A7CFF\\] flex justify-between items-center list-none select-none \\[&::-webkit-details-marker\\]:hidden pr-2"/g, 'className="cursor-pointer py-5 md:py-6 font-semibold text-[16px] md:text-[17px] transition-colors duration-300 flex justify-between items-center list-none select-none [&::-webkit-details-marker]:hidden pr-2" style={{ color: isDark ? "#eff2f6" : "#222" }}');
faq = faq.replace(/className="pb-5 md:pb-6 pr-12 text-\\[#555\\] text-\\[14px\\] md:text-\\[15px\\] font-medium leading-\\[1\.65\\]"/g, 'className="pb-5 md:pb-6 pr-12 text-[14px] md:text-[15px] font-medium leading-[1.65]" style={{ color: isDark ? "#a8b3cf" : "#555" }}');

let itypes = fs.readFileSync('interview-types/page.tsx', 'utf-8');
itypes = itypes.replace(/import \{ ForceLight \} from "@\/components\/force-light";\n/, '');
itypes = itypes.replace(/const router = useRouter\(\);/g, `const router = useRouter();\n  const [isDark, setIsDark] = useState(false);\n  useEffect(() => {\n    if (typeof window !== 'undefined' && localStorage.getItem('practers-dark') === 'true') {\n      setIsDark(true);\n    }\n  }, []);`);
itypes = itypes.replace(/<ForceLight>\s*/, '');
itypes = itypes.replace(/<\/ForceLight>\s*/, '');
itypes = itypes.replace(/className="min-h-screen bg-\\[#f4f5f7\\] text-\\[#1a1a1a\\] antialiased overflow-x-hidden"/, 'className="min-h-screen antialiased overflow-x-hidden"\n        style={{ backgroundColor: isDark ? "#222222" : "#f4f5f7", color: isDark ? "#eff2f6" : "#1a1a1a", fontFamily: "\'Inter\', sans-serif" }}');
itypes = itypes.replace(/className="bg-white border text-center border-\\[#e8e8e8\\]"/g, 'className="border text-center border-[#e8e8e8]" style={{ backgroundColor: isDark ? "#303030" : "white", borderColor: isDark ? "#3e3e3e" : "#e8e8e8" }}');
itypes = itypes.replace(/className="bg-white rounded-3xl border border-\\[#e8e8e8\\]"/g, 'className="rounded-3xl border border-[#e8e8e8]" style={{ backgroundColor: isDark ? "#303030" : "white", borderColor: isDark ? "#3e3e3e" : "#e8e8e8" }}');

fs.writeFileSync('faq/page.tsx', faq);
fs.writeFileSync('interview-types/page.tsx', itypes);
