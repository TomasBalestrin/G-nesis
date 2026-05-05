import { useEffect, useRef, useState } from "react";
import { Building2, Upload, User } from "lucide-react";

import { useToast } from "@/hooks/useToast";
import {
  getAppStateValue,
  setAppStateValue,
  uploadKnowledgeFile,
} from "@/lib/tauri-bridge";

const USER_NAME_KEY = "user_name";
const COMPANY_NAME_KEY = "company_name";

/**
 * Página inicial do Settings (Figma v2 white-02). 3 seções: Perfil
 * (nome + empresa em app_state), Arquivos da base (dropzone .md
 * funcional — chama uploadKnowledgeFile, sem listagem por enquanto),
 * Resumo do contexto (placeholder estático). Title Lora Medium 40px,
 * separadores 1px var(--gv2-border) entre seções.
 *
 * Por ora a listagem de arquivos e o regenerate ficaram fora — a UI
 * é só a dropzone + container do resumo, conforme spec do prompt.
 * KnowledgeSection (legacy) continua disponível pra surfaces que
 * ainda referenciam.
 */
export function KnowledgeBasePage() {
  return (
    <div
      className="h-full overflow-y-auto"
      style={{ background: "var(--gv2-bg)" }}
    >
      <div
        style={{
          maxWidth: "889px",
          margin: "0 auto",
          padding: "60px 30px 120px",
          display: "flex",
          flexDirection: "column",
          gap: "45px",
        }}
      >
        <PageHeader />
        <Divider />
        <ProfileSection />
        <Divider />
        <FilesSection />
        <Divider />
        <SummarySection />
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <header style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <h1
        style={{
          fontFamily: "Lora, Georgia, serif",
          fontWeight: 500,
          fontSize: "40px",
          lineHeight: 1.1,
          color: "var(--gv2-text)",
          margin: 0,
        }}
      >
        Base de Conhecimento
      </h1>
      <p
        style={{
          fontFamily: "Inter, system-ui, sans-serif",
          fontWeight: 400,
          fontSize: "15px",
          color: "var(--gv2-text-secondary)",
          margin: 0,
        }}
      >
        Perfil, documentos e o resumo que vai pro system prompt.
      </p>
    </header>
  );
}

function Divider() {
  return (
    <div
      aria-hidden
      style={{ height: "1px", background: "var(--gv2-border)" }}
    />
  );
}

function ProfileSection() {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getAppStateValue({ key: USER_NAME_KEY }),
      getAppStateValue({ key: COMPANY_NAME_KEY }),
    ])
      .then(([n, c]) => {
        if (cancelled) return;
        setName(n ?? "");
        setCompany(c ?? "");
      })
      .catch((err) => {
        if (!cancelled) {
          toast({
            title: "Falha ao carregar perfil",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  async function handleSave() {
    setSaving(true);
    try {
      await Promise.all([
        setAppStateValue({ key: USER_NAME_KEY, value: name.trim() }),
        setAppStateValue({ key: COMPANY_NAME_KEY, value: company.trim() }),
      ]);
      toast({ title: "Perfil salvo" });
    } catch (err) {
      toast({
        title: "Falha ao salvar perfil",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="Perfil"
      description="Seu nome e empresa entram no system prompt das conversas."
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "30px",
          alignItems: "flex-end",
        }}
      >
        <FormField
          label="Nome"
          icon={<User style={{ width: "10px", height: "12px" }} strokeWidth={1.5} />}
        >
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!loaded || saving}
            placeholder="Maria Silva"
          />
        </FormField>
        <FormField
          label="Empresa"
          icon={
            <Building2
              style={{ width: "16px", height: "12px" }}
              strokeWidth={1.5}
            />
          }
        >
          <TextInput
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            disabled={!loaded || saving}
            placeholder="Acme Inc."
          />
        </FormField>
        <button
          type="button"
          onClick={handleSave}
          disabled={!loaded || saving}
          style={{
            background: "var(--gv2-brand-button)",
            borderRadius: "var(--gv2-radius-sm)",
            padding: "15px 25px",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "15px",
            fontWeight: 500,
            color: "#000",
            border: "none",
            cursor: !loaded || saving ? "not-allowed" : "pointer",
            opacity: !loaded || saving ? 0.6 : 1,
            transition: "opacity 120ms",
          }}
        >
          {saving ? "Salvando..." : "Salvar Perfil"}
        </button>
      </div>
    </Section>
  );
}

function FilesSection() {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  async function ingest(list: FileList | File[]) {
    const arr = Array.from(list).filter((f) =>
      f.name.toLowerCase().endsWith(".md"),
    );
    if (arr.length === 0) {
      toast({
        title: "Apenas arquivos .md são aceitos",
        variant: "destructive",
      });
      return;
    }
    setUploading((n) => n + arr.length);
    for (const file of arr) {
      try {
        const content = await file.text();
        await uploadKnowledgeFile({ filename: file.name, content });
        toast({ title: `${file.name} adicionado` });
      } catch (err) {
        toast({
          title: `Falha ao subir ${file.name}`,
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      }
    }
    setUploading((n) => Math.max(0, n - arr.length));
  }

  const busy = uploading > 0;

  return (
    <Section
      title="Arquivos da base"
      description="Markdown sobre você, seus processos e ferramentas. Cada upload regenera o resumo."
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void ingest(e.dataTransfer.files);
        }}
        style={{
          width: "100%",
          maxWidth: "829px",
          height: "147px",
          background: "var(--gv2-input-bg)",
          backdropFilter: "blur(8.8px)",
          WebkitBackdropFilter: "blur(8.8px)",
          border: `2px dashed ${
            dragging ? "var(--gv2-brand)" : "var(--gv2-dropzone-border)"
          }`,
          borderRadius: "var(--gv2-radius-md)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          cursor: "pointer",
          transition: "border-color 120ms",
        }}
      >
        <Upload
          style={{ width: "16px", height: "18px" }}
          strokeWidth={1.5}
          color="var(--gv2-text-secondary)"
        />
        <p
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 400,
            fontSize: "20px",
            color: "var(--gv2-text-secondary)",
            margin: 0,
            textAlign: "center",
          }}
        >
          {busy
            ? `Subindo ${uploading} arquivo${uploading > 1 ? "s" : ""}...`
            : dragging
              ? "Solte aqui pra adicionar"
              : "Arraste .md ou clique pra selecionar"}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".md,text/markdown"
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) {
              void ingest(e.target.files);
              e.target.value = "";
            }
          }}
        />
      </div>
    </Section>
  );
}

function SummarySection() {
  return (
    <Section
      title="Resumo do contexto"
      description="Texto gerado a partir dos arquivos. Injetado no system prompt das conversas."
    >
      <div
        style={{
          width: "100%",
          maxWidth: "829px",
          height: "147px",
          background: "var(--gv2-input-bg)",
          border: "1px solid var(--gv2-border)",
          borderRadius: "var(--gv2-radius-md)",
          padding: "30px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 400,
            fontSize: "20px",
            color: "var(--gv2-text-secondary)",
            margin: 0,
          }}
        >
          Nenhum Resumo ainda
        </p>
      </div>
    </Section>
  );
}

interface SectionProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

function Section({ title, description, children }: SectionProps) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "45px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <h2
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontWeight: 500,
            fontSize: "20px",
            color: "var(--gv2-text)",
            margin: 0,
          }}
        >
          {title}
        </h2>
        <p
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 400,
            fontSize: "15px",
            color: "var(--gv2-text-secondary)",
            margin: 0,
          }}
        >
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

interface FormFieldProps {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function FormField({ label, icon, children }: FormFieldProps) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: "15px",
          color: "var(--gv2-text)",
        }}
      >
        <span style={{ color: "var(--gv2-text-secondary)" }}>{icon}</span>
        {label}
      </span>
      {children}
    </label>
  );
}

function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return (
    <input
      {...props}
      type="text"
      spellCheck={false}
      style={{
        width: "235px",
        background: "var(--gv2-input-bg)",
        border: "1px solid var(--gv2-input-border)",
        borderRadius: "var(--gv2-radius-sm)",
        padding: "15px",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "15px",
        color: "var(--gv2-text)",
        outline: "none",
        transition: "border-color 120ms",
      }}
    />
  );
}
