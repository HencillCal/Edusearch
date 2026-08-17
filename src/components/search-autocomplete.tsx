import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch, type SearchSuggestion } from "@/lib/api";

type SearchAutocompleteProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  inputClassName?: string;
  wrapperClassName?: string;
  buttonLabel?: string;
};

export function SearchAutocomplete({
  value,
  onChange,
  onSubmit,
  placeholder = "Search course, topic, question or document",
  inputClassName = "h-10 w-full rounded-full border border-border bg-surface pl-9 pr-4 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25",
  wrapperClassName = "",
  buttonLabel,
}: SearchAutocompleteProps) {
  const [debounced, setDebounced] = useState(value);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [value]);

  const suggestions = useQuery({
    queryKey: ["search-suggestions", debounced],
    queryFn: () =>
      apiFetch<{ suggestions: SearchSuggestion[] }>(
        `/api/search/suggestions?q=${encodeURIComponent(debounced)}`,
      ),
    enabled: typeof window !== "undefined" && debounced.length >= 2,
    staleTime: 30_000,
    retry: false,
  });
  const items = suggestions.data?.suggestions ?? [];
  const open = focused && value.trim().length >= 2 && items.length > 0;

  const submit = (nextValue = value) => {
    const cleaned = nextValue.trim();
    setFocused(false);
    setActiveIndex(-1);
    onSubmit(cleaned);
  };

  return (
    <form
      className={`relative ${wrapperClassName}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit(activeIndex >= 0 ? (items[activeIndex]?.value ?? value) : value);
      }}
    >
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setActiveIndex(-1);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onKeyDown={(event) => {
            if (!open) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(current + 1, items.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Escape") {
              setFocused(false);
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          className={inputClassName}
        />
        {buttonLabel && (
          <button
            type="submit"
            className="absolute right-2 top-2 h-12 rounded-full bg-brand px-6 text-sm font-semibold text-brand-foreground transition hover:opacity-90"
          >
            {buttonLabel}
          </button>
        )}
      </label>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-50 overflow-hidden rounded-xl border border-border bg-card text-left shadow-lift">
          {items.map((item, index) => (
            <button
              key={`${item.type}-${item.value}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(item.value);
                submit(item.value);
              }}
              className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-sm transition ${activeIndex === index ? "bg-accent" : "hover:bg-accent"}`}
            >
              <span className="min-w-0 truncate font-medium">{item.value}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {item.type.replace("-", " ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
