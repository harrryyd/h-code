import { useCallback, useEffect, useRef, useState } from "react";
import type { TodoCategory, TodoItem, TodoMutation } from "@t3tools/contracts";
import { ensureLocalApi } from "~/localApi";

export interface UseTodosResult {
  categories: TodoCategory[];
  items: TodoItem[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  mutate: (mutations: TodoMutation[]) => Promise<void>;
}

export function useTodos(): UseTodosResult {
  const [categories, setCategories] = useState<TodoCategory[]>([]);
  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    ensureLocalApi()
      .todos.load()
      .then((result) => {
        if (!mountedRef.current) return;
        setCategories([...result.categories]);
        setItems([...result.items]);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setCategories([]);
        setItems([]);
        setError(err instanceof Error ? err.message : "Failed to load todos");
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setLoading(false);
      });
  }, []);

  const mutate = useCallback(async (mutations: TodoMutation[]) => {
    const result = await ensureLocalApi().todos.mutate({ mutations });
    if (!mountedRef.current) return;
    setCategories([...result.categories]);
    setItems([...result.items]);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  return { categories, items, loading, error, reload: load, mutate };
}
