import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  loading: boolean;
  prompt: string | null;
  translate: Translate;
}

export function SystemPromptPanel({ loading, prompt, translate }: Props) {
  return (
    <section
      aria-label={translate("system.prompt")}
      className="flex h-[min(600px,50dvh)] min-h-55 flex-col border-b bg-card"
    >
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {prompt ? (
          <div className="whitespace-pre-wrap font-mono text-xs/relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {prompt}
          </div>
        ) : (
          <Empty className="flex-none items-start gap-0 rounded-none border-0 p-0 text-left">
            <EmptyHeader className="items-start text-left">
              <EmptyTitle className="text-xs font-normal italic text-muted-foreground [overflow-wrap:anywhere]">
                {prompt === ""
                  ? translate("system.empty")
                  : loading
                    ? translate("system.loading")
                    : translate("system.load")}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </section>
  );
}
