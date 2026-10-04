import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn("flex max-h-[320px] w-full flex-col overflow-hidden bg-white", className)}
    {...props}
  />
));

Command.displayName = CommandPrimitive.displayName;

export function CommandInput(props: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-200 px-3">
      <Search className="h-4 w-4 text-slate-400" />
      <CommandPrimitive.Input
        className="h-11 w-full border-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
        {...props}
      />
    </div>
  );
}

export const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[260px] overflow-y-auto p-1", className)}
    {...props}
  />
));

CommandList.displayName = CommandPrimitive.List.displayName;

export const CommandEmpty = CommandPrimitive.Empty;
export const CommandGroup = CommandPrimitive.Group;

export const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "flex min-h-10 cursor-pointer items-center gap-2 rounded px-3 text-sm outline-none data-[selected=true]:bg-slate-100",
      className,
    )}
    {...props}
  />
));

CommandItem.displayName = CommandPrimitive.Item.displayName;
