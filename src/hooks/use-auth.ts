import { useQuery } from "@tanstack/react-query";
import { apiFetch, type AuthUser } from "@/lib/api";

export function useAuth() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => apiFetch<{ user: AuthUser | null }>("/api/auth/me"),
    staleTime: 30_000,
    retry: false,
    enabled: typeof window !== "undefined",
  });
}
