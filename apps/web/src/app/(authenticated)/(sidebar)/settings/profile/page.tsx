"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/page-header";
import { api, getApiBaseUrl } from "@/lib/api";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { PhoneVerificationBanner } from "@/components/auth/PhoneVerificationBanner";
import { MSG91PhoneVerification } from "@/components/auth/MSG91PhoneVerification";

export default function SettingsPage() {
    useEffect(() => { document.title = "Profile Settings | Mockr"; }, []);
    const { session, signOut, user, refreshUser } = useAuth();
    const router = useRouter();

    const [isLoading, setIsLoading] = useState(false);

    // Editing states for different sections
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [isEditingInfo, setIsEditingInfo] = useState(false);
    const [isEditingSocial, setIsEditingSocial] = useState(false);
    const [isEditingExperience, setIsEditingExperience] = useState(false);

    // Success states for save buttons
    const [savedProfile, setSavedProfile] = useState(false);
    const [savedInfo, setSavedInfo] = useState(false);
    const [savedSocial, setSavedSocial] = useState(false);
    const [savedExperience, setSavedExperience] = useState(false);

    // Avatar upload/modal state
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [avatarError, setAvatarError] = useState<string | null>(null);
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);

    // Phone verification state
    const [showPhoneModal, setShowPhoneModal] = useState(false);
    const [showChangePhoneModal, setShowChangePhoneModal] = useState(false);

    // Resume state (keeping existing resume flow)
    interface ResumeItem { id: string; fileName: string; fileUrl: string; uploadedAt: string; }
    const [resumes, setResumes] = useState<ResumeItem[]>([]);
    const [resumesLoading, setResumesLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState<string | null>(null);
    const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
    const [editingNameId, setEditingNameId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState("");
    const [renameSaving, setRenameSaving] = useState(false);

    // Blog posts state
    interface BlogPost {
        id: string;
        slug: string;
        title: string;
        subtitle: string | null;
        coverImage: string | null;
        status: string;
        publishedAt: string | null;
        tags: string[];
    }
    const [blogs, setBlogs] = useState<BlogPost[]>([]);
    const [blogsLoading, setBlogsLoading] = useState(true);

    // Delete account state - REMOVED (now in main settings page)

    // Form states
    const [formData, setFormData] = useState({
        fullName: "",
        username: "",
        mobile: "",
        country: "",
        gender: "",
        birthday: "",
        location: "",
        website: "",
        githubUrl: "",
        linkedinUrl: "",
        twitterUrl: "",
        readmeUrl: "",
        skills: [] as string[],
        workExperience: [] as any[],
        education: [] as any[],
    });

    // Populate form data when user loads
    useEffect(() => {
        if (user) {
            setFormData({
                fullName: user.fullName || "",
                username: user.username || "",
                mobile: user.mobile || "",
                country: user.country || "",
                gender: user.gender || "",
                birthday: user.birthday || "",
                location: user.location || "",
                website: user.website || "",
                githubUrl: user.githubUrl || "",
                linkedinUrl: user.linkedinUrl || "",
                twitterUrl: user.twitterUrl || "",
                readmeUrl: user.readmeUrl || "",
                skills: user.skills || [],
                workExperience: user.workExperience || [],
                education: user.education || [],
            });
        }
    }, [user]);

    // Resumes logic...
    useEffect(() => {
        const fetchResumes = async () => {
            try {
                const { data } = await createSupabaseBrowserClient().auth.getSession();
                const token = data.session?.access_token;
                if (!token) return;
                const res = await api.get<{ resumes: ResumeItem[] }>("/resumes", token);
                setResumes(res.resumes || []);
            } catch { /* silent */ } finally {
                setResumesLoading(false);
            }
        };
        fetchResumes();
    }, []);

    // Fetch blogs
    useEffect(() => {
        const fetchBlogs = async () => {
            try {
                const { data } = await createSupabaseBrowserClient().auth.getSession();
                const token = data.session?.access_token;
                if (!token) return;
                const posts = await api.get<BlogPost[]>("/blog/my-posts", token);
                // Only show published posts on profile
                const publishedPosts = posts.filter(post => post.status === "published");
                setBlogs(publishedPosts);
            } catch { /* silent */ } finally {
                setBlogsLoading(false);
            }
        };
        fetchBlogs();
    }, []);

    const handleUploadResume = async (file: File) => {
        if (file.type !== "application/pdf") { setUploadError("Only PDF files are accepted"); return; }
        if (file.size > 10 * 1024 * 1024) { setUploadError("Maximum file size is 10MB"); return; }
        setUploadError(null);
        setUploading(true);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) throw new Error("Not authenticated");
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch(`${getApiBaseUrl()}/resumes/upload`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: fd,
            });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || "Upload failed"); }
            const result = await res.json();
            setResumes(prev => [{ id: result.id, fileName: file.name, fileUrl: result.fileUrl || "", uploadedAt: new Date().toISOString() }, ...prev]);
        } catch (err: any) {
            setUploadError(err.message || "Upload failed");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleRename = async (resume: ResumeItem) => {
        const trimmed = editingName.trim();
        const currentName = resume.fileName.replace(/\.pdf$/i, "");
        if (!trimmed || trimmed === currentName) { setEditingNameId(null); setEditingName(""); return; }
        setRenameSaving(true);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) return;
            const result = await api.patch<{ id: string; fileName: string }>(`/resumes/${resume.id}`, { fileName: trimmed }, token);
            setResumes(prev => prev.map(r => r.id === resume.id ? { ...r, fileName: result.fileName } : r));
            setEditingNameId(null);
            setEditingName("");
        } catch { }
        finally { setRenameSaving(false); }
    };

    const handlePreview = async (resume: ResumeItem) => {
        if (signedUrls[resume.id]) { setPreviewUrl(signedUrls[resume.id]); return; }
        setPreviewLoading(resume.id);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) return;
            const res = await api.get<{ url: string }>(`/resumes/${resume.id}/download`, token);
            setSignedUrls(prev => ({ ...prev, [resume.id]: res.url }));
            setPreviewUrl(res.url);
        } catch { alert("Failed to load preview."); }
        finally { setPreviewLoading(null); }
    };

    useEffect(() => {
        if (resumes.length === 0) return;
        const fetchAll = async () => {
            try {
                const { data } = await createSupabaseBrowserClient().auth.getSession();
                const token = data.session?.access_token;
                if (!token) return;
                const results = await Promise.all(
                    resumes.map(r =>
                        api.get<{ url: string }>(`/resumes/${r.id}/download`, token)
                            .then(res => ({ id: r.id, url: res.url }))
                            .catch(() => null)
                    )
                );
                const urls: Record<string, string> = {};
                results.forEach(r => { if (r) urls[r.id] = r.url; });
                setSignedUrls(prev => ({ ...prev, ...urls }));
            } catch { }
        };
        fetchAll();
    }, [resumes]);

    // Avatar Logic
    const handleAvatarUpload = async (file: File) => {
        const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        if (!allowed.includes(file.type)) { setAvatarError("Only JPEG, PNG, WebP, or GIF allowed."); return; }
        if (file.size > 2 * 1024 * 1024) { setAvatarError("Image must be under 2MB."); return; }
        setAvatarError(null);
        setAvatarUploading(true);
        try {
            const token = session?.access_token;
            if (!token) throw new Error("Not authenticated");
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch(`${getApiBaseUrl()}/users/me/avatar`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: fd,
            });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || "Upload failed"); }
            await refreshUser();
        } catch (err: any) {
            setAvatarError(err.message || "Upload failed");
        } finally {
            setAvatarUploading(false);
        }
    };

    // Save Logic — sanitize empty strings → null for URL/enum fields before sending
    const sanitizeForApi = (data: typeof formData) => ({
        ...data,
        // empty string is not a valid URL — send null instead
        website:    data.website?.trim()    || null,
        githubUrl:  data.githubUrl?.trim()  || null,
        linkedinUrl: data.linkedinUrl?.trim() || null,
        twitterUrl: data.twitterUrl?.trim() || null,
        readmeUrl:  data.readmeUrl?.trim()  || null,
        // empty string is not in the gender enum — send null instead
        gender:     data.gender || null,
        // other nullable strings
        mobile:     data.mobile?.trim()   || null,
        country:    data.country?.trim()  || null,
        location:   data.location?.trim() || null,
        birthday:   data.birthday?.trim() || null,
        username:   data.username?.trim() || null,
    });

    const handleSave = async (section: "profile" | "info" | "social" | "experience") => {
        setIsLoading(true);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) { alert("Session expired — please sign in again."); return; }
            await api.patch("/users/me", sanitizeForApi(formData), token);
            
            // Show success state
            if (section === "profile") setSavedProfile(true);
            if (section === "info") setSavedInfo(true);
            if (section === "social") setSavedSocial(true);
            if (section === "experience") setSavedExperience(true);
            
            // Hide success state and exit edit mode after 2 seconds
            setTimeout(() => {
                if (section === "profile") { setSavedProfile(false); setIsEditingProfile(false); }
                if (section === "info") { setSavedInfo(false); setIsEditingInfo(false); }
                if (section === "social") { setSavedSocial(false); setIsEditingSocial(false); }
                if (section === "experience") { setSavedExperience(false); setIsEditingExperience(false); }
            }, 2000);
            
        } catch (error: any) {
            console.error("[profile save] error:", error);
            alert(error?.message || "Failed to update profile");
            return;
        } finally {
            setIsLoading(false);
        }
        refreshUser().catch(err => console.error("[profile refresh] error:", err));
    };

    // Skills handling
    const [skillInput, setSkillInput] = useState("");
    const handleAddSkill = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const val = skillInput.trim();
            if (val && !formData.skills.includes(val)) {
                setFormData({ ...formData, skills: [...formData.skills, val] });
            }
            setSkillInput("");
        }
    };
    const removeSkill = (skill: string) => {
        setFormData({ ...formData, skills: formData.skills.filter(s => s !== skill) });
    };

    // List Handlers
    const addWork = () => setFormData({ ...formData, workExperience: [...formData.workExperience, { id: Math.random().toString(), company: "", title: "", startDate: "", endDate: "", description: "" }] });
    const removeWork = (id: string) => setFormData({ ...formData, workExperience: formData.workExperience.filter(w => w.id !== id) });
    const updateWork = (id: string, field: string, value: string) => {
        setFormData({ ...formData, workExperience: formData.workExperience.map(w => w.id === id ? { ...w, [field]: value } : w) });
    };

    const addEducation = () => setFormData({ ...formData, education: [...formData.education, { id: Math.random().toString(), institution: "", degree: "", field: "", startDate: "", endDate: "" }] });
    const removeEducation = (id: string) => setFormData({ ...formData, education: formData.education.filter(e => e.id !== id) });
    const updateEducation = (id: string, field: string, value: string) => {
        setFormData({ ...formData, education: formData.education.map(e => e.id === id ? { ...e, [field]: value } : e) });
    };

    const initial = user?.fullName?.charAt(0).toUpperCase() || "U";

    return (
        <div className="flex-1 overflow-auto bg-[#FAFBFC] dark:bg-lc-bg flex flex-col">
            {/* Phone Verification Banner - shows at top if not verified */}
            {!user?.mobileVerified && <PhoneVerificationBanner />}
            
            <PageHeader titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Profile</h1>} showBack backUrl="/settings" />

            <main className="flex-1 flex flex-col items-center py-10 px-4">
                <div className="w-full max-w-[800px] space-y-6">

                    {/* CARD 1: Profile Summary */}
                    <div className="bg-white dark:bg-lc-surface rounded-2xl p-8 border border-slate-100 dark:border-lc-border shadow-sm relative group">
                        <button
                            onClick={() => {
                                if (isEditingProfile) handleSave("profile");
                                else setIsEditingProfile(true);
                            }}
                            disabled={isLoading}
                            className="absolute top-6 right-6 p-2 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors"
                        >
                            {isLoading && isEditingProfile ? (
                                <svg className="animate-spin h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : savedProfile ? (
                                <span className="material-symbols-outlined text-lg text-green-600">check</span>
                            ) : isEditingProfile ? (
                                <span className="material-symbols-outlined text-lg">save</span>
                            ) : (
                                <span className="material-symbols-outlined text-lg">edit_square</span>
                            )}
                        </button>

                        <div className="flex flex-col items-start gap-4">
                            {/* Hidden avatar file input */}
                            <input
                                ref={avatarInputRef}
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                className="hidden"
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarUpload(f); if (avatarInputRef.current) avatarInputRef.current.value = ""; }}
                            />
                            
                            <div
                                className="relative size-20 rounded-full bg-slate-400 flex items-center justify-center text-white font-bold text-3xl cursor-pointer hover:ring-2 hover:ring-primary/40 transition-all overflow-hidden shrink-0 group-avatar"
                                onClick={() => setIsAvatarModalOpen(true)}
                                title="Click to view full picture"
                            >
                                {user?.avatarUrl ? (
                                    <img src={user.avatarUrl} alt={user.fullName} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                                ) : (
                                    initial
                                )}
                            </div>
                            {avatarError && (
                                <p className="text-xs text-red-500 -mt-2">{avatarError}</p>
                            )}

                            {isEditingProfile ? (
                                <div className="space-y-3 w-full max-w-sm mt-2">
                                    <input
                                        type="text"
                                        value={formData.fullName}
                                        onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                        placeholder="Full Name"
                                        className="w-full px-3 py-2 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-lg font-bold"
                                    />
                                    <input
                                        type="text"
                                        value={formData.username}
                                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                        placeholder="Username"
                                        className="w-full px-3 py-2 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-sm text-slate-500 dark:text-slate-300"
                                    />
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">
                                        {user?.fullName || "Update your name"}
                                    </h1>
                                    <p className="text-slate-500 text-sm">
                                        {user?.username ? (user.username.startsWith('@') ? user.username : `@${user.username}`) : "@username"}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* CARD 2: Personal Information (General) */}
                    <div className="bg-white dark:bg-lc-surface rounded-2xl p-8 border border-slate-100 dark:border-lc-border shadow-sm relative">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                                General Information
                            </h2>
                            <button
                                onClick={() => {
                                    if (isEditingInfo) handleSave("info");
                                    else setIsEditingInfo(true);
                                }}
                                disabled={isLoading}
                                className="p-2 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors -mr-2"
                            >
                                {isLoading && isEditingInfo ? (
                                    <svg className="animate-spin h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ) : savedInfo ? (
                                    <span className="material-symbols-outlined text-lg text-green-600">check</span>
                                ) : isEditingInfo ? (
                                    <span className="material-symbols-outlined text-lg">save</span>
                                ) : (
                                    <span className="material-symbols-outlined text-lg">edit_square</span>
                                )}
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-8">
                            {/* Email */}
                            <div className="flex gap-4 items-center">
                                <span className="material-symbols-outlined text-slate-400 shrink-0">mail</span>
                                <div className="flex-1">
                                    <p className="text-slate-500 text-xs font-semibold mb-0.5">Email</p>
                                    <p className="text-slate-800 dark:text-white text-[15px]">{user?.email}</p>
                                </div>
                            </div>

                            {/* Mobile */}
                            <div className="flex gap-4 items-center">
                                <span className="material-symbols-outlined text-slate-400 shrink-0">call</span>
                                <div className="flex-1">
                                    <p className="text-slate-500 text-xs font-semibold mb-0.5">Phone Number</p>
                                    <div className="flex items-center gap-2">
                                        <p className={`text-[15px] ${user?.mobile ? "text-slate-800 dark:text-white" : "text-slate-400"}`}>
                                            {user?.mobile || "Not specified"}
                                        </p>
                                        {user?.mobile && user?.mobileVerified && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-xs font-semibold rounded-full border border-green-200 dark:border-green-800">
                                                <span className="material-symbols-outlined text-[12px]">verified</span>
                                                Verified
                                            </span>
                                        )}
                                        {user?.mobile && !user?.mobileVerified && (
                                            <button
                                                onClick={() => setShowPhoneModal(true)}
                                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-semibold rounded-full border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                                            >
                                                <span className="material-symbols-outlined text-[12px]">warning</span>
                                                Verify Now
                                            </button>
                                        )}
                                        {!user?.mobile && (
                                            <button
                                                onClick={() => setShowPhoneModal(true)}
                                                className="text-xs text-primary hover:text-primary/80 font-semibold"
                                            >
                                                Add & Verify
                                            </button>
                                        )}
                                        {user?.mobile && user?.mobileVerified && (
                                            <button
                                                onClick={() => setShowChangePhoneModal(true)}
                                                className="text-xs text-primary hover:text-primary/80 font-semibold"
                                            >
                                                Change
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Gender */}
                            <div className="flex gap-4 items-center">
                                <span className="material-symbols-outlined text-slate-400 shrink-0">person</span>
                                <div className="flex-1">
                                    <p className="text-slate-500 text-xs font-semibold mb-0.5">Gender</p>
                                    {isEditingInfo ? (
                                        <select
                                            value={formData.gender}
                                            onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                                            className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[15px]"
                                        >
                                            <option value="">Select Gender</option>
                                            <option value="male">Male</option>
                                            <option value="female">Female</option>
                                            <option value="non_binary">Non-binary</option>
                                            <option value="prefer_not_to_say">Prefer not to say</option>
                                        </select>
                                    ) : (
                                        <p className={`text-[15px] ${user?.gender ? "text-slate-800 dark:text-white capitalize" : "text-slate-400"}`}>
                                            {user?.gender ? user.gender.replace(/_/g, " ") : "Not specified"}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Birthday */}
                            <div className="flex gap-4 items-center">
                                <span className="material-symbols-outlined text-slate-400 shrink-0">cake</span>
                                <div className="flex-1">
                                    <p className="text-slate-500 text-xs font-semibold mb-0.5">Birthday</p>
                                    {isEditingInfo ? (
                                        <input
                                            type="date"
                                            value={formData.birthday || ""}
                                            onChange={(e) => setFormData({ ...formData, birthday: e.target.value })}
                                            className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[15px]"
                                        />
                                    ) : (
                                        <p className={`text-[15px] ${user?.birthday ? "text-slate-800 dark:text-white" : "text-slate-400"}`}>
                                            {user?.birthday ? new Date(user.birthday).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "Not specified"}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Location */}
                            <div className="flex gap-4 items-center md:col-span-2">
                                <span className="material-symbols-outlined text-slate-400 shrink-0">location_on</span>
                                <div className="flex-1">
                                    <p className="text-slate-500 text-xs font-semibold mb-0.5">Location</p>
                                    {isEditingInfo ? (
                                        <input
                                            type="text"
                                            value={formData.location}
                                            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                            placeholder="City, State, Country"
                                            className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[15px]"
                                        />
                                    ) : (
                                        <p className={`text-[15px] ${user?.location ? "text-slate-800 dark:text-white" : "text-slate-400"}`}>
                                            {user?.location || "Not specified"}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* CARD 3: Websites & Socials */}
                    <div className="bg-white dark:bg-lc-surface rounded-2xl p-8 border border-slate-100 dark:border-lc-border shadow-sm relative">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                                Websites & Social Links
                            </h2>
                            <button
                                onClick={() => {
                                    if (isEditingSocial) handleSave("social");
                                    else setIsEditingSocial(true);
                                }}
                                disabled={isLoading}
                                className="p-2 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors -mr-2"
                            >
                                {isLoading && isEditingSocial ? (
                                    <svg className="animate-spin h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ) : savedSocial ? (
                                    <span className="material-symbols-outlined text-lg text-green-600">check</span>
                                ) : isEditingSocial ? (
                                    <span className="material-symbols-outlined text-lg">save</span>
                                ) : (
                                    <span className="material-symbols-outlined text-lg">edit_square</span>
                                )}
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-8">
                            {/* Website */}
                            <div className="flex gap-4 items-center">
                                <span className="material-symbols-outlined text-slate-400 shrink-0">language</span>
                                <div className="flex-1">
                                    <p className="text-slate-500 text-xs font-semibold mb-0.5">Personal Website</p>
                                    {isEditingSocial ? (
                                        <input
                                            type="url"
                                            value={formData.website}
                                            onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                                            placeholder="https://..."
                                            className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[15px]"
                                        />
                                    ) : (
                                        <p className={`text-[15px] ${user?.website ? "text-primary hover:underline cursor-pointer" : "text-slate-400"}`} onClick={() => user?.website && window.open(user.website, '_blank')}>
                                            {user?.website || "Not specified"}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* GitHub */}
                            <div className="flex gap-4 items-center">
                                <span className="material-symbols-outlined text-slate-400 shrink-0">code</span>
                                <div className="flex-1">
                                    <p className="text-slate-500 text-xs font-semibold mb-0.5">GitHub</p>
                                    {isEditingSocial ? (
                                        <input
                                            type="url"
                                            value={formData.githubUrl}
                                            onChange={(e) => setFormData({ ...formData, githubUrl: e.target.value })}
                                            placeholder="https://github.com/..."
                                            className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[15px]"
                                        />
                                    ) : (
                                        <p className={`text-[15px] ${user?.githubUrl ? "text-primary hover:underline cursor-pointer" : "text-slate-400"}`} onClick={() => user?.githubUrl && window.open(user.githubUrl, '_blank')}>
                                            {user?.githubUrl || "Not specified"}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* LinkedIn */}
                            <div className="flex gap-4 items-center">
                                <span className="material-symbols-outlined text-slate-400 shrink-0">work</span>
                                <div className="flex-1">
                                    <p className="text-slate-500 text-xs font-semibold mb-0.5">LinkedIn</p>
                                    {isEditingSocial ? (
                                        <input
                                            type="url"
                                            value={formData.linkedinUrl}
                                            onChange={(e) => setFormData({ ...formData, linkedinUrl: e.target.value })}
                                            placeholder="https://linkedin.com/in/..."
                                            className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[15px]"
                                        />
                                    ) : (
                                        <p className={`text-[15px] ${user?.linkedinUrl ? "text-primary hover:underline cursor-pointer" : "text-slate-400"}`} onClick={() => user?.linkedinUrl && window.open(user.linkedinUrl, '_blank')}>
                                            {user?.linkedinUrl || "Not specified"}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Twitter / X */}
                            <div className="flex gap-4 items-center">
                                <span className="material-symbols-outlined text-slate-400 shrink-0">chat_bubble</span>
                                <div className="flex-1">
                                    <p className="text-slate-500 text-xs font-semibold mb-0.5">X (Twitter)</p>
                                    {isEditingSocial ? (
                                        <input
                                            type="url"
                                            value={formData.twitterUrl}
                                            onChange={(e) => setFormData({ ...formData, twitterUrl: e.target.value })}
                                            placeholder="https://x.com/..."
                                            className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[15px]"
                                        />
                                    ) : (
                                        <p className={`text-[15px] ${user?.twitterUrl ? "text-primary hover:underline cursor-pointer" : "text-slate-400"}`} onClick={() => user?.twitterUrl && window.open(user.twitterUrl, '_blank')}>
                                            {user?.twitterUrl || "Not specified"}
                                        </p>
                                    )}
                                </div>
                            </div>

                             {/* ReadMe */}
                             <div className="flex gap-4 items-center md:col-span-2">
                                <span className="material-symbols-outlined text-slate-400 shrink-0">menu_book</span>
                                <div className="flex-1">
                                    <p className="text-slate-500 text-xs font-semibold mb-0.5">ReadMe</p>
                                    {isEditingSocial ? (
                                        <input
                                            type="url"
                                            value={formData.readmeUrl}
                                            onChange={(e) => setFormData({ ...formData, readmeUrl: e.target.value })}
                                            placeholder="Link to your ReadMe"
                                            className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[15px]"
                                        />
                                    ) : (
                                        <p className={`text-[15px] ${user?.readmeUrl ? "text-primary hover:underline cursor-pointer" : "text-slate-400"}`} onClick={() => user?.readmeUrl && window.open(user.readmeUrl, '_blank')}>
                                            {user?.readmeUrl || "Not specified"}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* CARD 4: Experience */}
                    <div className="bg-white dark:bg-lc-surface rounded-2xl p-8 border border-slate-100 dark:border-lc-border shadow-sm relative">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                                    Experience & Skills
                                </h2>
                                <p className="text-sm text-slate-500 mt-1">Share your growth from learning to career.</p>
                            </div>
                            <button
                                onClick={() => {
                                    if (isEditingExperience) handleSave("experience");
                                    else setIsEditingExperience(true);
                                }}
                                disabled={isLoading}
                                className="p-2 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors -mr-2"
                            >
                                {isLoading && isEditingExperience ? (
                                    <svg className="animate-spin h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ) : savedExperience ? (
                                    <span className="material-symbols-outlined text-lg text-green-600">check</span>
                                ) : isEditingExperience ? (
                                    <span className="material-symbols-outlined text-lg">save</span>
                                ) : (
                                    <span className="material-symbols-outlined text-lg">edit_square</span>
                                )}
                            </button>
                        </div>

                        <div className="space-y-8">
                            
                            {/* Skills Section */}
                            <div>
                                <h3 className="text-[15px] font-bold text-slate-700 dark:text-white mb-3">Skills</h3>
                                {isEditingExperience ? (
                                    <div className="space-y-2">
                                        <div className="flex gap-2 flex-wrap">
                                            {formData.skills.map(skill => (
                                                <span key={skill} className="px-3 py-1 bg-slate-100 dark:bg-lc-hover text-slate-700 dark:text-slate-200 text-sm rounded-full flex items-center gap-1 border border-slate-200 dark:border-lc-border">
                                                    {skill}
                                                    <button onClick={() => removeSkill(skill)} className="text-slate-400 hover:text-red-500 ml-1">
                                                        <span className="material-symbols-outlined text-[14px]">close</span>
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                        <input
                                            type="text"
                                            value={skillInput}
                                            onChange={(e) => setSkillInput(e.target.value)}
                                            onKeyDown={handleAddSkill}
                                            placeholder="Type a skill and hit Enter"
                                            className="w-full px-3 py-2 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[14px]"
                                        />
                                    </div>
                                ) : (
                                    <div className="flex gap-2 flex-wrap">
                                        {user?.skills?.length ? user.skills.map(skill => (
                                            <span key={skill} className="px-3 py-1 bg-slate-50 dark:bg-lc-bg text-slate-700 dark:text-slate-200 text-sm rounded-full border border-slate-200 dark:border-lc-border">
                                                {skill}
                                            </span>
                                        )) : <span className="text-sm text-slate-400">No skills added</span>}
                                    </div>
                                )}
                            </div>

                            {/* Work Experience */}
                            <div>
                                <div className="flex justify-between items-center mb-3">
                                    <h3 className="text-[15px] font-bold text-slate-700 dark:text-white">Work Experience</h3>
                                    {isEditingExperience && (
                                        <button onClick={addWork} className="text-sm text-primary hover:text-primary/80 font-semibold flex items-center gap-1">
                                            <span className="material-symbols-outlined text-[16px]">add</span> Add Role
                                        </button>
                                    )}
                                </div>

                                <div className="space-y-4">
                                    {(isEditingExperience ? formData.workExperience : (user?.workExperience || [])).length === 0 && !isEditingExperience && (
                                        <p className="text-sm text-slate-400">No work experience added.</p>
                                    )}
                                    {(isEditingExperience ? formData.workExperience : (user?.workExperience || [])).map(work => (
                                        <div key={work.id} className="p-4 border border-slate-200 dark:border-lc-border rounded-xl relative">
                                            {isEditingExperience ? (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div className="md:col-span-2 flex justify-between">
                                                        <div className="font-semibold text-sm text-slate-500">Edit Role</div>
                                                        <button onClick={() => removeWork(work.id)} className="text-red-500 hover:text-red-600"><span className="material-symbols-outlined text-[16px]">delete</span></button>
                                                    </div>
                                                    <input type="text" placeholder="Company Name" value={work.company} onChange={e => updateWork(work.id, 'company', e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[14px]" />
                                                    <input type="text" placeholder="Job Title" value={work.title} onChange={e => updateWork(work.id, 'title', e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[14px]" />
                                                    <input type="month" value={work.startDate} onChange={e => updateWork(work.id, 'startDate', e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[14px] text-slate-500" />
                                                    <input type="month" value={work.endDate || ""} onChange={e => updateWork(work.id, 'endDate', e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[14px] text-slate-500" />
                                                    <textarea placeholder="Description" value={work.description || ""} onChange={e => updateWork(work.id, 'description', e.target.value)} rows={2} className="md:col-span-2 w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[14px]" />
                                                </div>
                                            ) : (
                                                <div className="flex gap-4">
                                                    <div className="size-10 bg-slate-100 dark:bg-lc-bg rounded flex items-center justify-center shrink-0">
                                                        <span className="material-symbols-outlined text-slate-400 text-xl">work</span>
                                                    </div>
                                                    <div>
                                                        <h4 className="font-bold text-slate-800 dark:text-white leading-tight">{work.title}</h4>
                                                        <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">{work.company}</p>
                                                        <p className="text-xs text-slate-400 mt-1">{work.startDate} - {work.endDate || "Present"}</p>
                                                        {work.description && <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">{work.description}</p>}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Education */}
                            <div>
                                <div className="flex justify-between items-center mb-3">
                                    <h3 className="text-[15px] font-bold text-slate-700 dark:text-white">Education</h3>
                                    {isEditingExperience && (
                                        <button onClick={addEducation} className="text-sm text-primary hover:text-primary/80 font-semibold flex items-center gap-1">
                                            <span className="material-symbols-outlined text-[16px]">add</span> Add Education
                                        </button>
                                    )}
                                </div>

                                <div className="space-y-4">
                                    {(isEditingExperience ? formData.education : (user?.education || [])).length === 0 && !isEditingExperience && (
                                        <p className="text-sm text-slate-400">No education added.</p>
                                    )}
                                    {(isEditingExperience ? formData.education : (user?.education || [])).map(edu => (
                                        <div key={edu.id} className="p-4 border border-slate-200 dark:border-lc-border rounded-xl relative">
                                            {isEditingExperience ? (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div className="md:col-span-2 flex justify-between">
                                                        <div className="font-semibold text-sm text-slate-500">Edit Education</div>
                                                        <button onClick={() => removeEducation(edu.id)} className="text-red-500 hover:text-red-600"><span className="material-symbols-outlined text-[16px]">delete</span></button>
                                                    </div>
                                                    <input type="text" placeholder="Institution" value={edu.institution} onChange={e => updateEducation(edu.id, 'institution', e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[14px]" />
                                                    <input type="text" placeholder="Degree (e.g., BSc Computer Science)" value={edu.degree} onChange={e => updateEducation(edu.id, 'degree', e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[14px]" />
                                                    <input type="month" value={edu.startDate} onChange={e => updateEducation(edu.id, 'startDate', e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[14px] text-slate-500" />
                                                    <input type="month" value={edu.endDate || ""} onChange={e => updateEducation(edu.id, 'endDate', e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 dark:border-lc-border dark:bg-lc-bg dark:text-white rounded-lg text-[14px] text-slate-500" />
                                                </div>
                                            ) : (
                                                <div className="flex gap-4">
                                                    <div className="size-10 bg-slate-100 dark:bg-lc-bg rounded flex items-center justify-center shrink-0">
                                                        <span className="material-symbols-outlined text-slate-400 text-xl">school</span>
                                                    </div>
                                                    <div>
                                                        <h4 className="font-bold text-slate-800 dark:text-white leading-tight">{edu.institution}</h4>
                                                        <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">{edu.degree}</p>
                                                        <p className="text-xs text-slate-400 mt-1">{edu.startDate} - {edu.endDate || "Present"}</p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                        </div>
                    </div>

                    {/* CARD 5: My Resumes (Unchanged) */}
                    <div className="bg-white dark:bg-lc-surface rounded-2xl p-8 border border-slate-100 dark:border-lc-border shadow-sm">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="application/pdf"
                            className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadResume(f); }}
                        />

                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">My Resumes</h2>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                className="flex items-center gap-1 text-sm font-semibold font-nunito text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                            >
                                {uploading ? (
                                    <div className="size-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <span className="material-symbols-outlined text-[16px]">add</span>
                                )}
                                {uploading ? "Uploading…" : "Add Resume"}
                            </button>
                        </div>

                        {uploadError && (
                            <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-900/30 rounded-lg text-sm text-red-600 dark:text-red-400">
                                <span className="material-symbols-outlined text-[16px]">error</span>
                                {uploadError}
                            </div>
                        )}

                        {resumesLoading ? (
                            <div className="flex gap-4">
                                {[1, 2].map(i => (
                                    <div key={i} className="w-36 h-48 rounded-xl bg-slate-100 dark:bg-lc-hover animate-pulse" />
                                ))}
                            </div>
                        ) : resumes.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-10 text-center">
                                <div className="size-14 rounded-2xl bg-slate-50 dark:bg-lc-hover border border-slate-100 dark:border-lc-border flex items-center justify-center mb-3">
                                    <span className="material-symbols-outlined text-3xl text-slate-300 dark:text-slate-500">description</span>
                                </div>
                                <p className="text-sm font-medium font-nunito text-slate-500 dark:text-[#ababab]">No resumes uploaded yet</p>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Upload a PDF resume to get started</p>
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={uploading}
                                    className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold font-nunito bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
                                >
                                    {uploading ? (
                                        <div className="size-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <span className="material-symbols-outlined text-[16px]">upload_file</span>
                                    )}
                                    {uploading ? "Uploading…" : "Upload Resume"}
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-4">
                                {resumes.map((resume) => {
                                    const name = resume.fileName.replace(/\.pdf$/i, "");
                                    const date = new Date(resume.uploadedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
                                    return (
                                        <div
                                            key={resume.id}
                                            className="group relative w-36 cursor-pointer"
                                            onClick={() => handlePreview(resume)}
                                        >
                                            <div className="w-36 h-48 rounded-xl border border-slate-200 dark:border-lc-border bg-white shadow-sm overflow-hidden relative transition-all group-hover:shadow-md group-hover:border-primary/40 group-hover:-translate-y-0.5">
                                                <div className="absolute inset-0 bg-white" />
                                                {signedUrls[resume.id] ? (
                                                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                                                        <iframe
                                                            src={`${signedUrls[resume.id]}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                                                            title={name}
                                                            style={{
                                                                position: "absolute",
                                                                top: 0,
                                                                left: "50%",
                                                                marginLeft: "-350px",
                                                                width: "700px",
                                                                height: "990px",
                                                                transform: "scale(0.2057)",
                                                                transformOrigin: "top center",
                                                                border: "none",
                                                                background: "white",
                                                            }}
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="absolute inset-0 flex items-center justify-center z-10">
                                                        <div className="size-8 border-2 border-slate-200 border-t-primary rounded-full animate-spin" />
                                                    </div>
                                                )}

                                                {previewLoading === resume.id && (
                                                    <div className="absolute inset-0 bg-white/70 dark:bg-black/50 flex items-center justify-center z-20">
                                                        <div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                                    </div>
                                                )}

                                                <div className="absolute bottom-0 inset-x-0 h-14 bg-gradient-to-t from-white via-white/90 to-transparent z-10" />
                                                <div className="absolute bottom-2 inset-x-0 px-2 text-center z-10">
                                                    <p className="text-[10px] font-semibold font-nunito text-slate-700 leading-tight line-clamp-1">{name}</p>
                                                    <p className="text-[9px] text-slate-400 mt-0.5">PDF</p>
                                                </div>
                                            </div>

                                            <div className="mt-2 px-0.5" onClick={e => e.stopPropagation()}>
                                                {editingNameId === resume.id ? (
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            autoFocus
                                                            value={editingName}
                                                            onChange={e => setEditingName(e.target.value)}
                                                            onKeyDown={async e => {
                                                                if (e.key === "Enter") await handleRename(resume);
                                                                if (e.key === "Escape") { setEditingNameId(null); setEditingName(""); }
                                                            }}
                                                            onBlur={() => handleRename(resume)}
                                                            disabled={renameSaving}
                                                            maxLength={100}
                                                            className="w-full text-[11px] font-semibold font-nunito text-slate-700 dark:text-[#ccc] bg-transparent border-b border-primary outline-none pb-0.5 truncate"
                                                        />
                                                        {renameSaving && <div className="size-3 border border-primary border-t-transparent rounded-full animate-spin shrink-0" />}
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1">
                                                        <p className="text-[12px] font-semibold font-nunito text-slate-700 dark:text-[#ccc] truncate flex-1">{name}</p>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setEditingNameId(resume.id); setEditingName(name); }}
                                                            className="size-6 flex items-center justify-center rounded-md text-slate-400 hover:text-primary hover:bg-primary/5 transition-colors shrink-0"
                                                            title="Rename"
                                                        >
                                                            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
                                                        </button>
                                                    </div>
                                                )}
                                                <p className="text-[11px] text-slate-400 dark:text-slate-500">{date}</p>
                                            </div>
                                        </div>
                                    );
                                })}

                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    className="group w-36 h-48 rounded-xl border-2 border-dashed border-slate-200 dark:border-lc-border flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all"
                                >
                                    {uploading ? (
                                        <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            <div className="size-10 rounded-full bg-slate-100 dark:bg-lc-hover flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                                                <span className="material-symbols-outlined text-slate-400 group-hover:text-primary transition-colors">add</span>
                                            </div>
                                            <p className="text-[11px] font-semibold font-nunito text-slate-400 group-hover:text-primary transition-colors">Upload more</p>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* CARD 6: My Blogs */}
                    <div className="bg-white dark:bg-lc-surface rounded-2xl p-8 border border-slate-100 dark:border-lc-border shadow-sm">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">My Blogs</h2>
                        </div>

                        {blogsLoading ? (
                            <div className="flex items-center justify-center py-10">
                                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                            </div>
                        ) : blogs.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-10 text-center">
                                <div className="size-14 rounded-2xl bg-slate-50 dark:bg-lc-hover border border-slate-100 dark:border-lc-border flex items-center justify-center mb-3">
                                    <span className="material-symbols-outlined text-3xl text-slate-300 dark:text-slate-500">article</span>
                                </div>
                                <p className="text-sm font-medium font-nunito text-slate-500 dark:text-[#ababab]">No blogs yet</p>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Start writing your first blog post</p>
                                
                                {/* Action Buttons */}
                                <div className="flex items-center gap-3 mt-6">
                                    <Link
                                        href="/blog/my-blogs"
                                        className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold font-nunito bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all duration-200 active:scale-[0.98]"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">article</span>
                                        My Blogs
                                    </Link>
                                    <Link
                                        href="/blog/editor"
                                        className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold font-nunito bg-[#007AFF] text-white hover:bg-[#0051D5] transition-all duration-200 shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/25 active:scale-[0.98]"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">edit_note</span>
                                        Write
                                    </Link>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {blogs.slice(0, 3).map((blog) => (
                                    <Link
                                        key={blog.id}
                                        href={`/blog/${blog.slug}`}
                                        className="block p-4 rounded-xl border border-slate-100 dark:border-lc-border hover:border-primary/30 dark:hover:border-primary/30 hover:bg-slate-50 dark:hover:bg-lc-hover transition-all group"
                                    >
                                        <div className="flex gap-4">
                                            {blog.coverImage && (
                                                <div className="w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-slate-100 dark:bg-lc-hover">
                                                    <img
                                                        src={blog.coverImage}
                                                        alt={blog.title}
                                                        className="w-full h-full object-cover"
                                                    />
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <h3 className="text-sm font-semibold font-nunito text-slate-800 dark:text-white line-clamp-1 group-hover:text-primary transition-colors">
                                                    {blog.title}
                                                </h3>
                                                {blog.subtitle && (
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                                                        {blog.subtitle}
                                                    </p>
                                                )}
                                                <div className="flex items-center gap-2 mt-2">
                                                    {blog.tags && blog.tags.length > 0 && (
                                                        <div className="flex gap-1">
                                                            {blog.tags.slice(0, 2).map((tag) => (
                                                                <span
                                                                    key={tag}
                                                                    className="px-2 py-0.5 text-[10px] font-medium rounded bg-primary/10 text-primary"
                                                                >
                                                                    {tag}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {blog.publishedAt && (
                                                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                                            {new Date(blog.publishedAt).toLocaleDateString("en-US", {
                                                                month: "short",
                                                                day: "numeric",
                                                                year: "numeric",
                                                            })}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </Link>
                                ))}
                                
                                {/* Action Buttons */}
                                <div className="flex items-center gap-3 pt-4 border-t border-slate-100 dark:border-lc-border">
                                    <Link
                                        href="/blog/my-blogs"
                                        className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold font-nunito bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all duration-200 active:scale-[0.98]"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">article</span>
                                        View All
                                    </Link>
                                    <Link
                                        href="/blog/editor"
                                        className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold font-nunito bg-[#007AFF] text-white hover:bg-[#0051D5] transition-all duration-200 shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/25 active:scale-[0.98]"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">edit_note</span>
                                        Write
                                    </Link>
                                </div>
                            </div>
                        )}
                    </div>

                </div>
            </main>

            {/* ── PDF Preview Modal ───────────────────────────── */}
            {previewUrl && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setPreviewUrl(null)} />
                    <div className="relative w-full max-w-3xl h-[85vh] bg-white dark:bg-lc-surface rounded-2xl shadow-2xl border border-slate-200 dark:border-lc-border overflow-hidden flex flex-col animate-in zoom-in-95 fade-in duration-200">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-lc-border shrink-0">
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary">picture_as_pdf</span>
                                <span className="text-sm font-semibold font-nunito text-slate-800 dark:text-white">Resume Preview</span>
                            </div>
                            <button
                                onClick={() => setPreviewUrl(null)}
                                className="size-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-slate-400 text-lg">close</span>
                            </button>
                        </div>
                        <iframe
                            src={previewUrl}
                            className="flex-1 w-full bg-slate-100 dark:bg-lc-bg"
                            title="Resume Preview"
                        />
                    </div>
                </div>
            )}

            {/* ── Avatar Modal ───────────────────────────── */}
            {isAvatarModalOpen && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsAvatarModalOpen(false)} />
                    
                    {/* Close button top right */}
                    <button
                        onClick={() => setIsAvatarModalOpen(false)}
                        className="absolute top-6 right-6 size-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer z-10"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                    
                    <div className="relative flex flex-col items-center gap-6 animate-in zoom-in-95 fade-in duration-200">
                        {/* Profile Picture */}
                        <div className="size-64 md:size-80 rounded-full bg-slate-800 flex items-center justify-center text-white font-bold text-7xl md:text-8xl overflow-hidden shadow-2xl relative">
                            {user?.avatarUrl ? (
                                <img src={user.avatarUrl} alt={user.fullName} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                            ) : (
                                initial
                            )}

                            {/* Upload spinner overlay */}
                            {avatarUploading && (
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center backdrop-blur-sm">
                                    <div className="size-12 border-4 border-white border-t-transparent rounded-full animate-spin" />
                                </div>
                            )}
                        </div>
                        
                        {/* Edit Button */}
                        <button
                            onClick={() => !avatarUploading && avatarInputRef.current?.click()}
                            disabled={avatarUploading}
                            className="flex items-center gap-2 px-6 py-3 rounded-full bg-white text-black font-semibold hover:bg-slate-100 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {avatarUploading ? (
                                <div className="size-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <span className="material-symbols-outlined text-[18px]">edit</span>
                            )}
                            {avatarUploading ? "Uploading..." : "Edit photo"}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Phone Verification Modal ───────────────────────────── */}
            {showPhoneModal && (
                <MSG91PhoneVerification
                    onClose={() => setShowPhoneModal(false)}
                    onSuccess={async () => {
                        setShowPhoneModal(false);
                        await refreshUser();
                    }}
                />
            )}

            {/* ── Change Phone Modal ───────────────────────────── */}
            {showChangePhoneModal && (
                <MSG91PhoneVerification
                    onClose={() => setShowChangePhoneModal(false)}
                    onSuccess={async () => {
                        setShowChangePhoneModal(false);
                        await refreshUser();
                    }}
                />
            )}
        </div>
    );
}
