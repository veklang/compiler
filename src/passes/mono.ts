import type { CheckResult, GenericInstantiation } from "@/core/checker";

export interface MonoSpecialization {
  kind: "Function" | "Method" | "Struct";
  originalName: string;
  ownerName?: string;
  mangledName: string;
  typeArgs: string[];
}

export interface MonoResult {
  specializations: MonoSpecialization[];
}

export function monomorphize(checkResult: CheckResult): MonoResult {
  const seen = new Set<string>();
  const specializations: MonoSpecialization[] = [];

  for (const inst of checkResult.instantiations) {
    const key = instKey(inst);
    if (seen.has(key)) continue;
    seen.add(key);

    const base = inst.ownerName ? `${inst.ownerName}__${inst.name}` : inst.name;

    specializations.push({
      kind: inst.kind,
      originalName: inst.name,
      ownerName: inst.ownerName,
      mangledName: mangleName(base, inst.typeArgs),
      typeArgs: inst.typeArgs,
    });
  }

  return { specializations };
}

export function mangleName(base: string, typeArgs: string[]): string {
  if (typeArgs.length === 0) return base;
  return `${base}__${typeArgs.map(mangleType).join("__")}`;
}

export function mangleType(typeStr: string): string {
  let s = typeStr.trim();
  if (s.endsWith("?")) return `opt_${mangleType(s.slice(0, -1).trim())}`;
  if (s.startsWith("(")) s = `tuple${s}`;
  return s
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function instKey(inst: GenericInstantiation): string {
  return `${inst.kind}|${inst.name}|${inst.ownerName ?? ""}|${inst.typeArgs.join(",")}`;
}
