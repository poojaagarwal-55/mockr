export default function CareersPage() {
    return (
        <main className="min-h-screen bg-white py-12 px-6 force-inter">
            <div className="mx-auto w-full max-w-4xl py-10 md:px-10">
                <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Careers at Mockr</h1>
                <p className="mt-4 text-sm leading-7 text-slate-700">
                    We are building the future of AI-powered interview preparation. If you enjoy solving hard product,
                    AI, and engineering problems, we would love to hear from you.
                </p>
                <section className="mt-8 space-y-4">
                    <h2 className="text-xl font-semibold text-slate-900">Open Roles</h2>
                    <p className="text-sm leading-7 text-slate-700">
                        We are currently hiring across engineering, product design, and growth. Share your profile and
                        portfolio to start the conversation.
                    </p>
                </section>
                <section className="mt-8 space-y-4">
                    <h2 className="text-xl font-semibold text-slate-900">Apply</h2>
                    <p className="text-sm leading-7 text-slate-700">
                        Send your resume and a short note about your background to support@practers.com.
                    </p>
                </section>
            </div>
        </main>
    );
}
