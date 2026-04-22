import * as React from "react"
import { cn } from "@/lib/utils"

function DatetimeInput({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <input
      type="datetime-local"
      className={cn(
        "w-full rounded border border-white/15 bg-white/5 px-2 py-1 text-sm text-inherit outline-none focus:border-white/30",
        className
      )}
      {...props}
    />
  )
}

export { DatetimeInput }
