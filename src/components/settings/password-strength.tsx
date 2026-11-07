import { cn } from "@/lib/utils";
import { passwordStrength } from "@/lib/validation";

const BAR = ["bg-danger", "bg-danger", "bg-warning", "bg-success", "bg-success"];

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const { score, label } = passwordStrength(password);
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn("h-1.5 flex-1 rounded-full", i <= Math.max(score, 1) ? BAR[score] : "bg-slate-200")} />
        ))}
      </div>
      <span className="w-20 text-right text-xs font-semibold text-muted">{label}</span>
    </div>
  );
}
