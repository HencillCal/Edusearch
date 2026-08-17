import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellPlus, BellRing } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { subjects as fallbackSubjects } from "@/lib/edusearch-data";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/subjects")({
  head: () => ({ meta: [{ title: "Browse subjects and topics — EduSearch AI" }] }),
  component: SubjectsPage,
});

type SubjectResponse = {
  subjects: Array<{
    name: string;
    description: string;
    count: number;
    topics: Array<{ name: string; synonyms: string[] }>;
  }>;
};

function SubjectsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["subjects"],
    queryFn: () => apiFetch<SubjectResponse>("/api/subjects"),
    enabled: typeof window !== "undefined",
    initialData: {
      subjects: fallbackSubjects.map((subject) => ({
        name: subject.name,
        description: "",
        count: subject.count,
        topics: subject.topics.map((name) => ({ name, synonyms: [] })),
      })),
    },
  });
  const followed = useQuery({
    queryKey: ["followed-topics"],
    queryFn: () => apiFetch<{ topics: Array<{ topicName: string }> }>("/api/followed-topics"),
    enabled: typeof window !== "undefined" && Boolean(auth.data?.user),
    retry: false,
  });
  const followedNames = new Set(
    (followed.data?.topics ?? []).map((topic) => topic.topicName.toLowerCase()),
  );

  const toggleFollow = async (topicName: string) => {
    if (!auth.data?.user) {
      toast.error("Log in to follow topics");
      return;
    }
    const isFollowing = followedNames.has(topicName.toLowerCase());
    try {
      await apiFetch(
        isFollowing
          ? `/api/followed-topics?topicName=${encodeURIComponent(topicName)}`
          : "/api/followed-topics",
        {
          method: isFollowing ? "DELETE" : "POST",
          ...(isFollowing ? {} : { body: JSON.stringify({ topicName }) }),
        },
      );
      toast.success(isFollowing ? `Unfollowed ${topicName}` : `Following ${topicName}`);
      await queryClient.invalidateQueries({ queryKey: ["followed-topics"] });
      await queryClient.invalidateQueries({ queryKey: ["home"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update followed topics");
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl">Browse by subject</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Subjects and topics organise the library internally. Direct search remains the primary way
          to find documents.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {query.data.subjects.map((subject) => (
            <div
              key={subject.name}
              className="card-lift rounded-xl border border-border bg-card p-5 shadow-soft"
            >
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-xl font-semibold">{subject.name}</h2>
                <span className="text-xs text-muted-foreground">
                  {subject.count.toLocaleString()} docs
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {subject.topics.map((topic) => {
                  const isFollowing = followedNames.has(topic.name.toLowerCase());
                  return (
                    <div
                      key={topic.name}
                      className="inline-flex items-center rounded-full border border-border bg-background pr-1"
                    >
                      <Link to="/search" search={{ q: topic.name }}>
                        <Badge
                          variant="outline"
                          className="cursor-pointer border-0 hover:text-brand"
                        >
                          {topic.name}
                        </Badge>
                      </Link>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-full"
                        onClick={() => toggleFollow(topic.name)}
                        aria-label={isFollowing ? `Unfollow ${topic.name}` : `Follow ${topic.name}`}
                        title={isFollowing ? "Unfollow topic" : "Follow topic"}
                      >
                        {isFollowing ? (
                          <BellRing className="size-3.5 text-brand" />
                        ) : (
                          <BellPlus className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
              <Link
                to="/search"
                search={{ q: subject.name }}
                className="mt-4 inline-block text-sm font-medium text-brand"
              >
                View all {subject.name} documents →
              </Link>
            </div>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
