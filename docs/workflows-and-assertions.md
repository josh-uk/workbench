# Workflows and assertions

## Ordered workflows

A workflow belongs to one project and contains a simple ordered list of saved
requests. It intentionally is not a graph: enabled steps execute from top to
bottom, one at a time. Each step can supply temporary runtime overrides and can
either stop the sequence or allow it to continue after a request or assertion
failure.

The runner calls the normal saved-request executor. This keeps variable
precedence, authentication, network policy, response limits, redaction,
cancellation, outputs, and history identical to an individual send. Outputs are
persisted before the next step starts, so a value such as `accessToken` can be
referenced as `{{accessToken}}` later in the same workflow.

Workflow definitions are edited from the project-level **Workflows** view.
Steps can be added, removed, reordered, disabled, renamed, and configured with a
failure policy. Saving validates that every request belongs to the same project.

![A successful two-step workflow](images/phase-10-workflows.png)

## Assertions

Assertions can be attached to a saved request or to an individual workflow
step. Request assertions run on every execution. Step assertions are added only
for that workflow step. Both owners use the same evaluator and appear together
in execution and workflow reports.

Supported assertions are:

- status equals or falls within a range;
- duration is below a millisecond threshold;
- header exists or equals a value;
- JSONPath exists, equals text/JSON, or matches a bounded regular expression;
- body contains text; and
- JSON body matches a JSON Schema.

An HTTP response can complete successfully while an assertion fails. The saved
request execution therefore retains both transport status and an independent
assertion pass state. In a workflow, a failed assertion marks the step and run
as failed and applies that step's stop/continue policy.

## Reports and headless reuse

Every run stores an aggregate summary and ordered step reports. Each step links
to the underlying request execution when available and records its assertion
results, output names, timing, failure policy, and redacted error. Reports
survive workflow deletion because historical workflow and request references
become nullable.

The framework-independent evaluator and server-only runner are callable
application boundaries. A future command-line or CI adapter can validate input
and invoke the runner directly; it does not need to import UI components or
reimplement request execution.
