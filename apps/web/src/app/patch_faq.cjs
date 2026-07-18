const fs = require('fs');
let code = fs.readFileSync('faq/page.tsx', 'utf-8');

code = code.replace(/import \{ ForceLight \} from "@\/components\/force-light";\n/, '');

code = code.replace(
  'const [searchQuery, setSearchQuery] = useState("");',
  'const [searchQuery, setSearchQuery] = useState("");\n  const [isDark, setIsDark] = useState(false);\n\n  useEffect(() => {\n    if (typeof window !== "undefined" && localStorage.getItem("practers-dark") === "true") {\n      setIsDark(true);\n    }\n  }, []);'
);

code = code.replace(
  '<ForceLight>',
  '<div className={isDark ? "inner-page-dark" : ""}>'
);

code = code.replace(
  '</ForceLight>',
  '</div>'
);

// Search inside FAQ to make it use the transparent generic classes or inner-page-dark-card
// For FAQ bg-white elements:
code = code.replace(
  /className="w-full bg-white border border-\\[#cccccc\\] text-\\[#111\\]/g,
  'className={`w-full border text-[#111] ${isDark ? "inner-page-dark-card" : "bg-white border-[#cccccc]"}`}'
);

code = code.replace(
  /className="text-center py-20 bg-white rounded-3xl border border-\\[#e8e8e8\\]"/g,
  'className={`text-center py-20 rounded-3xl border ${isDark ? "inner-page-dark-card" : "bg-white border-[#e8e8e8]"}`}'
);

code = code.replace(
  /className="py-8 bg-white border-t border-\\[#e8e8e8\\]"/g,
  'className={`py-8 border-t ${isDark ? "inner-page-dark-card" : "bg-white border-[#e8e8e8]"}`}'
);

fs.writeFileSync('faq/page.tsx', code);
