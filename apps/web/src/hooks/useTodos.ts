import { useEffect, useState } from "react";
import type { TodoCategory, TodoItem } from "@t3tools/contracts";
import { ensureLocalApi } from "~/localApi";

export function useTodos() {
  const [categories, setCategories] = useState<TodoCategory[]>([]);
  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ensureLocalApi()
      .todos.load()
      .then((result) => {
        setCategories([...result.categories]);
        setItems([...result.items]);
      })
      .catch(() => {
        setCategories([]);
        setItems([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return { categories, items, loading };
}
