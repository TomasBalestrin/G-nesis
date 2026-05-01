import { forwardRef, useId } from "react";
import type {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
} from "react";

import "./EliteInput.css";

interface SharedFieldProps {
  /** Texto da label acima do controle. Omite renderização quando ausente. */
  label?: ReactNode;
  /** Quando `true`, ativa o estilo de erro (border vermelha). Mesmo sem
   *  errorMessage o estado visual aparece — útil pra validação cruzada
   *  onde a mensagem mora em outro lugar (formulário, toast). */
  error?: boolean;
  /** Mensagem renderizada abaixo do controle quando presente. Implica
   *  `error=true` se o caller esqueceu de setar — o usuário sempre
   *  vê o erro junto com a borda vermelha. */
  errorMessage?: ReactNode;
  /** Classes extra concatenadas ao .fi. Caller usa pra spacing/grid
   *  helpers (Tailwind ou plain). */
  className?: string;
  /** Classes extra no wrapper .fi-field. */
  wrapperClassName?: string;
}

export interface InputProps
  extends SharedFieldProps,
    Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {}

export interface TextareaProps
  extends SharedFieldProps,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {}

/**
 * Input — Elite Premium (DESIGN.md §08).
 *
 * Pill shape: 38px de altura, border-radius 20px. Border 1px outline
 * que vira gold no focus. Sem outline / box-shadow / glow conforme
 * constraint do design system.
 *
 * Renderiza `<label>` + `<input>` + `<.fi-em>` (quando há erro) num
 * wrapper `.fi-field`. `id` é gerado via useId quando o caller não
 * passa um — mantém a associação `for`/`id` estável entre renders.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    error,
    errorMessage,
    className,
    wrapperClassName,
    id: idProp,
    ...rest
  },
  ref,
) {
  const fallbackId = useId();
  const id = idProp ?? fallbackId;
  const isError = error || Boolean(errorMessage);

  const inputClasses = ["fi", isError ? "fi-err" : null, className]
    .filter(Boolean)
    .join(" ");

  const wrapperClasses = ["fi-field", wrapperClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapperClasses}>
      {label !== undefined ? (
        <label htmlFor={id} className="fi-lb">
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={id}
        className={inputClasses}
        aria-invalid={isError || undefined}
        {...rest}
      />
      {errorMessage !== undefined ? (
        <span className="fi-em">{errorMessage}</span>
      ) : null}
    </div>
  );
});

/**
 * Textarea — mesma API do Input. Border-radius 14px (mais "soft"
 * que pill 20px do input — DESIGN.md §08), height 80px, resize
 * vertical. Cresce visualmente sem quebrar o layout em pílula.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      label,
      error,
      errorMessage,
      className,
      wrapperClassName,
      id: idProp,
      rows,
      ...rest
    },
    ref,
  ) {
    const fallbackId = useId();
    const id = idProp ?? fallbackId;
    const isError = error || Boolean(errorMessage);

    const textareaClasses = ["fi", isError ? "fi-err" : null, className]
      .filter(Boolean)
      .join(" ");

    const wrapperClasses = ["fi-field", wrapperClassName]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={wrapperClasses}>
        {label !== undefined ? (
          <label htmlFor={id} className="fi-lb">
            {label}
          </label>
        ) : null}
        <textarea
          ref={ref}
          id={id}
          className={textareaClasses}
          aria-invalid={isError || undefined}
          rows={rows}
          {...rest}
        />
        {errorMessage !== undefined ? (
          <span className="fi-em">{errorMessage}</span>
        ) : null}
      </div>
    );
  },
);
