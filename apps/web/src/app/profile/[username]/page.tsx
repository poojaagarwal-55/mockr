import { PublicJobProfile } from "@/components/job-profile/job-profile-builder";

export default async function PublicProfilePage({
    params,
}: {
    params: Promise<{ username: string }>;
}) {
    const { username } = await params;
    return <PublicJobProfile username={username} />;
}
