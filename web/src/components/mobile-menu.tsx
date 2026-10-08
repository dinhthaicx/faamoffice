"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Keep native details/summary behavior, including before hydration. */
export function MobileMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = ref.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      const menu = ref.current;
      if (event.key === "Escape" && menu?.open) {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return (
    <details
      ref={ref}
      className="group relative md:hidden"
      onClick={(event) => {
        // Also close on hash links, the current page, and language links.
        if (event.target instanceof Element && event.target.closest("a[href]")) event.currentTarget.open = false;
      }}
    >
      {children}
    </details>
  );
}
