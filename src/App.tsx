import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function App() {
  return (
    <div className="min-h-screen p-10 space-y-8">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-4xl font-extrabold tracking-tight">Genesis</h1>
          <Badge variant="info">v0.1.0</Badge>
        </div>
        <p className="text-text-2">
          Desktop skill orchestrator — design system ready.
        </p>
      </header>

      <Separator />

      <Tabs defaultValue="components" className="w-full">
        <TabsList>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="tokens">Tokens</TabsTrigger>
        </TabsList>

        <TabsContent value="components" className="space-y-6 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Buttons</CardTitle>
              <CardDescription>Variants and sizes</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
              <Button size="sm">Small</Button>
              <Button size="lg">Large</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Input</CardTitle>
              <CardDescription>With design-system focus ring</CardDescription>
            </CardHeader>
            <CardContent className="max-w-sm">
              <Input placeholder="Type something..." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Badges</CardTitle>
              <CardDescription>Status variants</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="destructive">Error</Badge>
              <Badge variant="info">Info</Badge>
              <Badge variant="outline">Outline</Badge>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tokens" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Theme tokens</CardTitle>
              <CardDescription>
                Active theme: <code className="font-mono">blue-dark</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {(
                [
                  ["--bg", "var(--bg)"],
                  ["--surface", "var(--surface)"],
                  ["--primary", "var(--primary)"],
                  ["--border", "var(--border)"],
                ] as const
              ).map(([name, value]) => (
                <div
                  key={name}
                  className="flex flex-col gap-2 rounded-lg border border-border p-3"
                >
                  <div
                    className="h-10 w-full rounded-md border border-[var(--border-sub)]"
                    style={{ background: value }}
                  />
                  <code className="font-mono text-xs text-text-2">{name}</code>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default App;
