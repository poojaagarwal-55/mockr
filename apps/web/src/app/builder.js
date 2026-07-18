const fs = require('fs');

// 1. layout.tsx
let layout = fs.readFileSync('layout.tsx', 'utf8');
if (!layout.includes('practers-dark')) {
  layout = layout.replace('<head>', '<head>\n        {/* Blocking script: read localStorage before first paint to prevent dark-mode flash */}\n        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(localStorage.getItem("practers-dark")==="true"){document.documentElement.dataset.dark="true";}}catch(e){}})();` }} />');
  fs.writeFileSync('layout.tsx', layout);
}

// 2. globals.css
let css = fs.readFileSync('globals.css', 'utf8');
if (!css.includes('html[data-dark="true"] .inner-page-dark')) {
  css += `

/* ========================
   Dark Mode — Transitions & Inner Pages
   ======================== */

#landing-page header a img { transition: filter 0.4s ease; }
#landing-page header button, #landing-page header a.get-started-btn { transition: background-color 0.4s ease, color 0.4s ease; }
#landing-page .companies-section img { transition: filter 0.4s ease; }
#landing-page .step-circle > div { transition: background-color 0.5s ease, border-color 0.45s ease, color 0.45s ease; }

html[data-dark="true"] { background-color: #222222; color-scheme: dark; }

html[data-dark="true"] .inner-page-dark { background-color: #222222 !important; color: #eff2f6 !important; }
html[data-dark="true"] .inner-page-dark-card { background-color: #2a2a2a !important; border-color: #3e3e3e !important; }
html[data-dark="true"] .inner-page-dark-text-muted { color: #a8b3cf !important; }
html[data-dark="true"] .inner-page-dark-border { border-color: #3e3e3e !important; }
`;
  fs.writeFileSync('globals.css', css);
}

// 3. FAQ
let faq = fs.readFileSync('faq/page.tsx', 'utf-8');
faq = faq.replace(/import \{ ForceLight \} from "@\/components\/force-light";\n/, '');
faq = faq.replace(
  'const [searchQuery, setSearchQuery] = useState("");',
  `const [searchQuery, setSearchQuery] = useState("");
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("practers-dark") === "true") {
      setIsDark(true);
    }
  }, []);`
);
faq = faq.replace(/<ForceLight>/g, '');
faq = faq.replace(/<\/ForceLight>/g, '');
faq = faq.replace('className="min-h-screen bg-[#f4f5f7] pb-24"', 'className={`min-h-screen pb-24 ${isDark ? "inner-page-dark" : "bg-[#f4f5f7]"}`}');
faq = faq.replace('className="sticky top-0 z-40 w-full bg-[#f4f5f7]/90 backdrop-blur-md border-b border-[#e8e8e8]"', 'className={`sticky top-0 z-40 w-full backdrop-blur-md border-b ${isDark ? "border-[#3e3e3e] bg-[rgba(34,34,34,0.9)]" : "bg-[#f4f5f7]/90 border-[#e8e8e8]"}`}');
faq = faq.replace('className="text-[15px] font-medium tracking-tight text-[#333] hover:text-[#4A7CFF] transition-colors"', 'className={`text-[15px] font-medium tracking-tight transition-colors hover:text-[#4A7CFF] ${isDark ? "text-[#eff2f6]" : "text-[#333]"}`}');
faq = faq.replace('className="w-full bg-white border border-[#cccccc] text-[#111] text-[16px] rounded-full py-3.5 pl-14 pr-6 placeholder:text-[#999] focus:outline-none focus:border-[#4A7CFF] transition-colors hover:border-[#a0a0a0]"', 'className={`w-full border text-[16px] rounded-full py-3.5 pl-14 pr-6 placeholder:text-[var(--ph)] focus:outline-none focus:border-[#4A7CFF] transition-colors ${isDark ? "bg-[#303030] text-[#eff2f6] border-[#444]" : "bg-white text-[#111] border-[#cccccc] hover:border-[#a0a0a0]"} {--ph: ${isDark ? "#777" : "#999"}}`}');
faq = faq.replace(/className="text-\\[2\.6rem\\] md:text-\\[3\.5rem\\] font-extrabold text-\\[#111\\] tracking-tight"/g, 'className={`text-[2.6rem] md:text-[3.5rem] font-extrabold tracking-tight ${isDark ? "text-[#eff2f6]" : "text-[#111]"}`}');
faq = faq.replace(/className="text-\\[22px\\] font-extrabold text-\\[#111\\] mb-6 tracking-tight flex items-center gap-3"/g, 'className={`text-[22px] font-extrabold mb-6 tracking-tight flex items-center gap-3 ${isDark ? "text-[#eff2f6]" : "text-[#111]"}`}');
faq = faq.replace(/className="flex flex-col border-t border-\\[#e8e8e8\\]"/g, 'className={`flex flex-col border-t ${isDark ? "border-[#3e3e3e]" : "border-[#e8e8e8]"}`}');
faq = faq.replace(/className="group border-b border-\\[#e8e8e8\\] overflow-hidden transition-all duration-200"/g, 'className={`group border-b overflow-hidden transition-all duration-200 ${isDark ? "border-[#3e3e3e]" : "border-[#e8e8e8]"}`}');
faq = faq.replace(/className="cursor-pointer py-5 md:py-6 font-semibold text-\\[16px\\] md:text-\\[17px\\] text-\\[#222\\] transition-colors duration-300 group-hover:text-\\[#4A7CFF\\] group-open:text-\\[#4A7CFF\\] flex justify-between items-center list-none select-none \\[&::-webkit-details-marker\\]:hidden pr-2"/g, 'className={`cursor-pointer py-5 md:py-6 font-semibold text-[16px] md:text-[17px] transition-colors duration-300 flex justify-between items-center list-none select-none [&::-webkit-details-marker]:hidden pr-2 ${isDark ? "text-[#eff2f6]" : "text-[#222]"}`}');
faq = faq.replace(/className="pb-5 md:pb-6 pr-12 text-\\[#555\\] text-\\[14px\\] md:text-\\[15px\\] font-medium leading-\\[1\.65\\]"/g, 'className={`pb-5 md:pb-6 pr-12 text-[14px] md:text-[15px] font-medium leading-[1.65] ${isDark ? "text-[#a8b3cf]" : "text-[#555]"}`}');
faq = faq.replace(/className="text-center py-20 bg-white rounded-3xl border border-\\[#e8e8e8\\]"/g, 'className={`text-center py-20 rounded-3xl border ${isDark ? "bg-[#303030] border-[#3e3e3e]" : "bg-white border-[#e8e8e8]"}`}');
faq = faq.replace(/className="text-\\[#555\\] text-lg font-medium"/g, 'className={`text-lg font-medium ${isDark ? "text-[#a8b3cf]" : "text-[#555]"}`}');
faq = faq.replace(/className="py-8 bg-white border-t border-\\[#e8e8e8\\]"/g, 'className={`py-8 border-t ${isDark ? "bg-[#222222] border-[#3e3e3e]" : "bg-white border-[#e8e8e8]"}`}');

// Also fix inline elements
faq = faq.replace('<Link href="/"><Image src="/logo_big.png" alt="Mockr" width={180} height={51} className="h-10 w-auto" /></Link>', '<Link href="/"><Image src="/logo_big.png" alt="Mockr" width={180} height={51} className="h-10 w-auto" style={{ filter: isDark ? "brightness(0) invert(1)" : "" }} /></Link>');
faq = faq.replace('<Link href="/login" className="hidden sm:block text-sm text-[#1a1a1a] px-4 py-2">Log In</Link>', '<Link href="/login" className={`hidden sm:block text-sm px-4 py-2 ${isDark ? "text-[#eff2f6]" : "text-[#1a1a1a]"}`}>Log In</Link>');
faq = faq.replace('<Link href="/login?tab=signup" className="bg-[#1a1a1a] text-white text-sm px-5 py-2.5 rounded-full hover:bg-[#333] transition-colors">', '<Link href="/login?tab=signup" className={`text-sm px-5 py-2.5 rounded-full transition-colors ${isDark ? "bg-[#FFE500] text-[#1a1a1a] hover:bg-[#f5dc00]" : "bg-[#1a1a1a] text-white hover:bg-[#333]"}`}>');

// Replace standard links in map
faq = faq.replace('className="text-[15px] font-medium tracking-tight text-[#333] hover:text-[#4A7CFF] transition-colors"', 'className={`text-[15px] font-medium tracking-tight transition-colors hover:text-[#4A7CFF] ${isDark ? "text-[#eff2f6]" : "text-[#333]"}`}');
faq = faq.replace('className="text-[15px] font-medium tracking-tight text-[#333] hover:text-[#4A7CFF] transition-colors"', 'className={`text-[15px] font-medium tracking-tight transition-colors hover:text-[#4A7CFF] ${isDark ? "text-[#eff2f6]" : "text-[#333]"}`}');
// just run dynamic replace manually for the array map links:
faq = faq.split('className="text-[15px] font-medium tracking-tight text-[#333] hover:text-[#4A7CFF] transition-colors"').join('className={`text-[15px] font-medium tracking-tight transition-colors hover:text-[#4A7CFF] ${isDark ? "text-[#eff2f6]" : "text-[#333]"}`}');


// 4. Interview Types Page
let types = fs.readFileSync('interview-types/page.tsx', 'utf-8');
types = types.replace(/import \{ ForceLight \} from "@\/components\/force-light";\n/, '');
types = types.replace('const router = useRouter();', 'const router = useRouter();\n  const [isDark, setIsDark] = useState(false);\n  useEffect(() => {\n    if (typeof window !== "undefined" && localStorage.getItem("practers-dark") === "true") {\n      setIsDark(true);\n    }\n  }, []);');
types = types.replace(/<ForceLight>/g, '');
types = types.replace(/<\/ForceLight>/g, '');

types = types.replace('className="min-h-screen bg-[#f4f5f7] text-[#1a1a1a] antialiased overflow-x-hidden"', 'className={`min-h-screen antialiased overflow-x-hidden ${isDark ? "inner-page-dark" : "bg-[#f4f5f7] text-[#1a1a1a]"}`}');
types = types.replace('className="sticky top-0 z-40 w-full bg-[#f4f5f7]/90 backdrop-blur-md border-b border-[#e8e8e8] transition-transform duration-300"', 'className={`sticky top-0 z-40 w-full backdrop-blur-md border-b transition-transform duration-300 ${isDark ? "bg-[rgba(34,34,34,0.9)] border-[#3e3e3e]" : "bg-[#f4f5f7]/90 border-[#e8e8e8]"}`}');
types = types.replace('<Link href="/"><Image src="/logo_big.png" alt="Mockr" width={180} height={51} className="h-10 w-auto" /></Link>', '<Link href="/"><Image src="/logo_big.png" alt="Mockr" width={180} height={51} className="h-10 w-auto" style={{ filter: isDark ? "brightness(0) invert(1)" : "" }} /></Link>');
types = types.split('className="text-[15px] font-medium tracking-tight text-[#333] hover:text-[#4A7CFF] transition-colors"').join('className={`text-[15px] font-medium tracking-tight transition-colors hover:text-[#4A7CFF] ${isDark ? "text-[#eff2f6]" : "text-[#333]"}`}');
types = types.replace('<Link href="/login" className="hidden sm:block text-sm text-[#1a1a1a] px-4 py-2">Log In</Link>', '<Link href="/login" className={`hidden sm:block text-sm px-4 py-2 ${isDark ? "text-[#eff2f6]" : "text-[#1a1a1a]"}`}>Log In</Link>');
types = types.replace('<Link href="/login?tab=signup" className="bg-[#1a1a1a] text-white text-sm px-5 py-2.5 rounded-full hover:bg-[#333] transition-colors">', '<Link href="/login?tab=signup" className={`text-sm px-5 py-2.5 rounded-full transition-colors ${isDark ? "bg-[#FFE500] text-[#1a1a1a] hover:bg-[#f5dc00]" : "bg-[#1a1a1a] text-white hover:bg-[#333]"}`}>');

types = types.split('className="bg-white border text-center border-[#e8e8e8]"').join('className={`border text-center ${isDark ? "inner-page-dark-card" : "bg-white border-[#e8e8e8]"}`}');
types = types.split('className="bg-white rounded-3xl border border-[#e8e8e8]"').join('className={`rounded-3xl border ${isDark ? "inner-page-dark-card" : "bg-white border-[#e8e8e8]"}`}');
types = types.split('className="text-[#555] text-lg md:text-xl max-w-2xl mx-auto"').join('className={`text-lg md:text-xl max-w-2xl mx-auto ${isDark ? "text-[#a8b3cf]" : "text-[#555]"}`}');
types = types.split('className="py-8 bg-white border-t border-[#e8e8e8]"').join('className={`py-8 border-t ${isDark ? "bg-[#222222] border-[#3e3e3e]" : "bg-white border-[#e8e8e8]"}`}');

// 5. Login Page
let login = fs.readFileSync('login/page.tsx', 'utf-8');
login = login.replace(/import \{ ForceLight \} from "@\/components\/force-light";\n/, '');
login = login.replace(/<ForceLight>/g, '');
login = login.replace(/<\/ForceLight>/g, '');
// Wait, login/page.tsx already has an `isDark` state and respects `practers-dark`!
// Let me verify if login DOES NOT have isDark inside it right now. Wait, I restored it so it might not.
if (!login.includes('const [isDark, setIsDark] = useState(false);')) {
  login = login.replace(/const \[isSubmitting, setIsSubmitting\] = useState\(false\);/, 'const [isSubmitting, setIsSubmitting] = useState(false);\n  const [isDark, setIsDark] = useState(false);\n\n  useEffect(() => {\n    if (typeof window !== "undefined" && localStorage.getItem("practers-dark") === "true") {\n      setIsDark(true);\n    }\n  }, []);');
  
  // Also inline styles
  login = login.replace(/className="min-h-screen grid lg:grid-cols-2 bg-\\[#f4f5f7\\]"/, 'className={`min-h-screen grid lg:grid-cols-2 ${isDark ? "inner-page-dark" : "bg-[#f4f5f7]"}`}');
  login = login.replace(/className="flex flex-col justify-between p-8 md:p-12 relative overflow-hidden bg-white rounded-r-3xl"/, 'className={`flex flex-col justify-between p-8 md:p-12 relative overflow-hidden rounded-r-3xl ${isDark ? "inner-page-dark-card shadow-lg" : "bg-white"}`}');
  login = login.replace(/className="text-3xl font-black text-slate-900 mb-2"/, 'className={`text-3xl font-black mb-2 ${isDark ? "text-[#eff2f6]" : "text-slate-900"}`}');
  login = login.replace(/className="text-slate-500"/, 'className={`text-slate-500 ${isDark ? "text-[#a8b3cf]" : "text-slate-500"}`}');
  login = login.replace(/className="w-full flex items-center justify-center gap-3 py-3\.5 px-4 bg-white border border-slate-200 rounded-full font-bold text-slate-700 hover:bg-slate-50 transition"/, 'className={`w-full flex items-center justify-center gap-3 py-3.5 px-4 border rounded-full font-bold transition ${isDark ? "bg-[#333] border-[#3e3e3e] text-[#eff2f6] hover:bg-[#444]" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"}`}');
  
  login = login.split('className="flex border-b mb-8"').join('className={`flex border-b mb-8 ${isDark ? "border-[#3e3e3e]" : ""}`}');
  login = login.replace(/className="hidden lg:flex flex-col bg-\\[#f8f9fa\\] p-12 relative"/, 'className={`hidden lg:flex flex-col p-12 relative ${isDark ? "bg-[#18181A]" : "bg-[#f8f9fa]"}`}');
  
}


fs.writeFileSync('faq/page.tsx', faq);
fs.writeFileSync('interview-types/page.tsx', types);
fs.writeFileSync('login/page.tsx', login);

console.log("Patched successfully");
