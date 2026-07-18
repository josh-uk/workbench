"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  assertionTypes,
  defaultAssertion,
  type AssertionDefinition,
  type AssertionType,
} from "@/core/assertions/domain";

const labels: Record<AssertionType, string> = {
  status_equals: "Status equals",
  status_range: "Status in range",
  duration_below: "Duration below",
  header_exists: "Header exists",
  header_equals: "Header equals",
  jsonpath_exists: "JSONPath exists",
  jsonpath_equals: "JSONPath equals",
  jsonpath_regex: "JSONPath matches regex",
  body_contains: "Body contains",
  body_schema: "Body matches JSON Schema",
};

const inputClass =
  "h-9 min-w-0 rounded-md border bg-background px-2.5 font-mono text-xs";

function ConfigurationFields({
  assertion,
  onChange,
}: {
  assertion: AssertionDefinition;
  onChange: (assertion: AssertionDefinition) => void;
}) {
  switch (assertion.type) {
    case "status_equals":
      return (
        <input
          aria-label="Expected status"
          className={inputClass}
          max={599}
          min={100}
          onChange={(event) =>
            onChange({
              ...assertion,
              configuration: { expected: Number(event.target.value) },
            })
          }
          type="number"
          value={assertion.configuration.expected}
        />
      );
    case "status_range":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            aria-label="Minimum status"
            className={inputClass}
            max={599}
            min={100}
            onChange={(event) =>
              onChange({
                ...assertion,
                configuration: {
                  ...assertion.configuration,
                  minimum: Number(event.target.value),
                },
              })
            }
            type="number"
            value={assertion.configuration.minimum}
          />
          <input
            aria-label="Maximum status"
            className={inputClass}
            max={599}
            min={100}
            onChange={(event) =>
              onChange({
                ...assertion,
                configuration: {
                  ...assertion.configuration,
                  maximum: Number(event.target.value),
                },
              })
            }
            type="number"
            value={assertion.configuration.maximum}
          />
        </div>
      );
    case "duration_below":
      return (
        <input
          aria-label="Maximum duration in milliseconds"
          className={inputClass}
          min={1}
          onChange={(event) =>
            onChange({
              ...assertion,
              configuration: { maximumMs: Number(event.target.value) },
            })
          }
          type="number"
          value={assertion.configuration.maximumMs}
        />
      );
    case "header_exists":
      return (
        <input
          aria-label="Header name"
          className={inputClass}
          onChange={(event) =>
            onChange({
              ...assertion,
              configuration: { name: event.target.value },
            })
          }
          placeholder="Content-Type"
          value={assertion.configuration.name}
        />
      );
    case "header_equals":
      return (
        <div className="grid gap-2 sm:grid-cols-[0.8fr_1.2fr_auto]">
          <input
            aria-label="Header name"
            className={inputClass}
            onChange={(event) =>
              onChange({
                ...assertion,
                configuration: {
                  ...assertion.configuration,
                  name: event.target.value,
                },
              })
            }
            placeholder="Content-Type"
            value={assertion.configuration.name}
          />
          <input
            aria-label="Expected header value"
            className={inputClass}
            onChange={(event) =>
              onChange({
                ...assertion,
                configuration: {
                  ...assertion.configuration,
                  expected: event.target.value,
                },
              })
            }
            placeholder="application/json"
            value={assertion.configuration.expected}
          />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              checked={assertion.configuration.caseSensitive}
              onChange={(event) =>
                onChange({
                  ...assertion,
                  configuration: {
                    ...assertion.configuration,
                    caseSensitive: event.target.checked,
                  },
                })
              }
              type="checkbox"
            />
            Match case
          </label>
        </div>
      );
    case "jsonpath_exists":
      return (
        <input
          aria-label="JSONPath"
          className={inputClass}
          onChange={(event) =>
            onChange({
              ...assertion,
              configuration: { path: event.target.value },
            })
          }
          placeholder="$.data.id"
          value={assertion.configuration.path}
        />
      );
    case "jsonpath_equals":
      return (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            aria-label="JSONPath"
            className={inputClass}
            onChange={(event) =>
              onChange({
                ...assertion,
                configuration: {
                  ...assertion.configuration,
                  path: event.target.value,
                },
              })
            }
            placeholder="$.data.status"
            value={assertion.configuration.path}
          />
          <input
            aria-label="Expected JSONPath value"
            className={inputClass}
            onChange={(event) =>
              onChange({
                ...assertion,
                configuration: {
                  ...assertion.configuration,
                  expected: event.target.value,
                },
              })
            }
            placeholder="ok"
            value={assertion.configuration.expected}
          />
          <select
            aria-label="JSONPath comparison mode"
            className={inputClass}
            onChange={(event) =>
              onChange({
                ...assertion,
                configuration: {
                  ...assertion.configuration,
                  mode: event.target.value as "text" | "json",
                },
              })
            }
            value={assertion.configuration.mode}
          >
            <option value="text">Text</option>
            <option value="json">JSON</option>
          </select>
        </div>
      );
    case "jsonpath_regex":
      return (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_5rem]">
          <input
            aria-label="JSONPath"
            className={inputClass}
            onChange={(event) =>
              onChange({
                ...assertion,
                configuration: {
                  ...assertion.configuration,
                  path: event.target.value,
                },
              })
            }
            placeholder="$.data.id"
            value={assertion.configuration.path}
          />
          <input
            aria-label="Regular expression"
            className={inputClass}
            onChange={(event) =>
              onChange({
                ...assertion,
                configuration: {
                  ...assertion.configuration,
                  pattern: event.target.value,
                },
              })
            }
            placeholder="^[a-z]+$"
            value={assertion.configuration.pattern}
          />
          <input
            aria-label="Regular expression flags"
            className={inputClass}
            onChange={(event) =>
              onChange({
                ...assertion,
                configuration: {
                  ...assertion.configuration,
                  flags: event.target.value,
                },
              })
            }
            placeholder="i"
            value={assertion.configuration.flags}
          />
        </div>
      );
    case "body_contains":
      return (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            aria-label="Expected body text"
            className={inputClass}
            onChange={(event) =>
              onChange({
                ...assertion,
                configuration: {
                  ...assertion.configuration,
                  text: event.target.value,
                },
              })
            }
            placeholder="expected text"
            value={assertion.configuration.text}
          />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              checked={assertion.configuration.caseSensitive}
              onChange={(event) =>
                onChange({
                  ...assertion,
                  configuration: {
                    ...assertion.configuration,
                    caseSensitive: event.target.checked,
                  },
                })
              }
              type="checkbox"
            />
            Match case
          </label>
        </div>
      );
    case "body_schema":
      return (
        <textarea
          aria-label="JSON Schema"
          className="min-h-32 w-full resize-y rounded-md border bg-code-background p-2.5 font-mono text-xs"
          onChange={(event) =>
            onChange({
              ...assertion,
              configuration: { schema: event.target.value },
            })
          }
          spellCheck={false}
          value={assertion.configuration.schema}
        />
      );
  }
}

export function AssertionEditor({
  assertions,
  emptyLabel = "No assertions configured.",
  onChange,
}: {
  assertions: AssertionDefinition[];
  emptyLabel?: string;
  onChange: (assertions: AssertionDefinition[]) => void;
}) {
  const replace = (index: number, assertion: AssertionDefinition) =>
    onChange(
      assertions.map((candidate, candidateIndex) =>
        candidateIndex === index ? assertion : candidate,
      ),
    );

  return (
    <div className="space-y-3">
      {assertions.length ? (
        assertions.map((assertion, index) => (
          <section
            className="space-y-3 rounded-lg border bg-surface-subtle p-3"
            key={assertion.id ?? index}
          >
            <div className="grid items-center gap-2 sm:grid-cols-[auto_1fr_14rem_auto]">
              <input
                aria-label={`Enable assertion ${index + 1}`}
                checked={assertion.enabled}
                className="size-4 accent-accent"
                onChange={(event) =>
                  replace(index, {
                    ...assertion,
                    enabled: event.target.checked,
                  })
                }
                type="checkbox"
              />
              <input
                aria-label={`Assertion ${index + 1} name`}
                className="h-9 min-w-0 rounded-md border bg-background px-2.5 text-xs"
                onChange={(event) =>
                  replace(index, { ...assertion, name: event.target.value })
                }
                value={assertion.name}
              />
              <select
                aria-label={`Assertion ${index + 1} type`}
                className="h-9 rounded-md border bg-background px-2.5 text-xs"
                onChange={(event) =>
                  replace(index, {
                    ...defaultAssertion(event.target.value as AssertionType),
                    id: assertion.id,
                    name: assertion.name,
                    enabled: assertion.enabled,
                  } as AssertionDefinition)
                }
                value={assertion.type}
              >
                {assertionTypes.map((type) => (
                  <option key={type} value={type}>
                    {labels[type]}
                  </option>
                ))}
              </select>
              <Button
                aria-label={`Remove assertion ${index + 1}`}
                onClick={() =>
                  onChange(
                    assertions.filter(
                      (_candidate, candidateIndex) => candidateIndex !== index,
                    ),
                  )
                }
                size="icon"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" className="size-3.5 text-red-500" />
              </Button>
            </div>
            <ConfigurationFields
              assertion={assertion}
              onChange={(value) => replace(index, value)}
            />
          </section>
        ))
      ) : (
        <p className="rounded-lg border border-dashed p-8 text-center text-xs text-muted">
          {emptyLabel}
        </p>
      )}
      <Button
        onClick={() =>
          onChange([...assertions, defaultAssertion("status_equals")])
        }
        variant="secondary"
      >
        <Plus aria-hidden="true" className="size-4" /> Add assertion
      </Button>
    </div>
  );
}
