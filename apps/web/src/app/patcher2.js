const fs = require('fs');

let faq = fs.readFileSync('faq/page.tsx', 'utf-8');
faq = faq.split('import { ForceLight } from "@/components/force-light";\n').join('');
if (!faq.includes('const [isDark, setIsDark] = useState(false);')) {
  faq = faq.split('const [searchQuery, setSearchQuery] = useState("");').join(`const [searchQuery, setSearchQuery] = useState("");\n  const [isDark, setIsDark] = useState(false);\n  useEffect(() => {\n    if (typeof window !== "undefined" && localStorage.getItem("practers-dark") === "true") {\n      setIsDark(true);\n    }\n  }, []);`);
}
faq = faq.split('<ForceLight>').join('');
faq = faq.split('</ForceLight>').join('');

faq = faq.split('className="min-h-screen bg-[#f4f5f7] pb-24"').join('className="min-h-screen pb-24"\n        style={{ backgroundColor: isDark ? "#222222" : "#f4f5f7", color: isDark ? "#eff2f6" : "#111" }}');
faq = faq.split('className="sticky top-0 z-40 w-full bg-[#f4f5f7]/90 backdrop-blur-md border-b border-[#e8e8e8]"').join('className="sticky top-0 z-40 w-full backdrop-blur-md border-b"\n        style={{ backgroundColor: isDark ? "rgba(34,34,34,0.9)" : "rgba(244,245,247,0.9)", borderColor: isDark ? "#3e3e3e" : "#e8e8e8" }}');

faq = faq.split('className="w-full bg-white border border-[#cccccc] text-[#111] text-[16px] rounded-full py-3.5 pl-14 pr-6 placeholder:text-[#999] focus:outline-none focus:border-[#4A7CFF] transition-colors hover:border-[#a0a0a0]"').join('className="w-full border text-[16px] rounded-full py-3.5 pl-14 pr-6 placeholder:text-[#999] focus:outline-none focus:border-[#4A7CFF] transition-colors"\n                  style={{ backgroundColor: isDark ? "#303030" : "white", borderColor: isDark ? "#444" : "#cccccc", color: isDark ? "#eff2f6" : "#111" }}');

faq = faq.split('className="flex flex-col border-t border-[#e8e8e8]"').join('className="flex flex-col border-t" style={{ borderColor: isDark ? "#3e3e3e" : "#e8e8e8" }}');
faq = faq.split('className="group border-b border-[#e8e8e8] overflow-hidden transition-all duration-200"').join('className="group border-b overflow-hidden transition-all duration-200" style={{ borderColor: isDark ? "#3e3e3e" : "#e8e8e8" }}');
faq = faq.split('className="cursor-pointer py-5 md:py-6 font-semibold text-[16px] md:text-[17px] text-[#222] transition-colors duration-300 group-hover:text-[#4A7CFF] group-open:text-[#4A7CFF] flex justify-between items-center list-none select-none [&::-webkit-details-marker]:hidden pr-2"').join('className="cursor-pointer py-5 md:py-6 font-semibold text-[16px] md:text-[17px] transition-colors duration-300 flex justify-between items-center list-none select-none [&::-webkit-details-marker]:hidden pr-2" style={{ color: isDark ? "#eff2f6" : "#222" }}');
faq = faq.split('className="pb-5 md:pb-6 pr-12 text-[#555] text-[14px] md:text-[15px] font-medium leading-[1.65]"').join('className="pb-5 md:pb-6 pr-12 text-[14px] md:text-[15px] font-medium leading-[1.65]" style={{ color: isDark ? "#a8b3cf" : "#555" }}');

let itypes = fs.readFileSync('interview-types/page.tsx', 'utf-8');
itypes = itypes.split('import { ForceLight } from "@/components/force-light";\n').join('');
if (!itypes.includes('const [isDark, setIsDark] = useState(false);')) {
  itypes = itypes.split('const router = useRouter();').join(`const router = useRouter();\n  const [isDark, setIsDark] = useState(false);\n  useEffect(() => {\n    if (typeof window !== "undefined" && localStorage.getItem("practers-dark") === "true") {\n      setIsDark(true);\n    }\n  }, []);`);
}
itypes = itypes.split('<ForceLight>').join('');
itypes = itypes.split('</ForceLight>').join('');

itypes = itypes.split('className="min-h-screen bg-[#f4f5f7] text-[#1a1a1a] antialiased overflow-x-hidden"').join('className="min-h-screen antialiased overflow-x-hidden"\n        style={{ backgroundColor: isDark ? "#222222" : "#f4f5f7", color: isDark ? "#eff2f6" : "#1a1a1a", fontFamily: "\'Inter\', sans-serif" }}');
itypes = itypes.split('className="bg-white border text-center border-[#e8e8e8]"').join('className="border text-center border-[#e8e8e8]" style={{ backgroundColor: isDark ? "#303030" : "white", borderColor: isDark ? "#3e3e3e" : "#e8e8e8" }}');
itypes = itypes.split('className="bg-white rounded-3xl border border-[#e8e8e8]"').join('className="rounded-3xl border border-[#e8e8e8]" style={{ backgroundColor: isDark ? "#303030" : "white", borderColor: isDark ? "#3e3e3e" : "#e8e8e8" }}');

fs.writeFileSync('faq/page.tsx', faq);
fs.writeFileSync('interview-types/page.tsx', itypes);
