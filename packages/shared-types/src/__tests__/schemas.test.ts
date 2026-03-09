import {
  TaskSchema,
  ApprovalSchema,
  ActionReceiptSchema,
  WorkflowStepSchema,
  WorkflowRunSchema,
  SCHEMAS,
} from '../schemas';

// ── TaskSchema ───────────────────────────────────────────────────────────────

describe('TaskSchema', () => {
  it('has $schema set to draft-07', () => {
    expect(TaskSchema.$schema).toBe('http://json-schema.org/draft-07/schema#');
  });

  it('has correct $id', () => {
    expect(TaskSchema.$id).toBe('https://ai-ops.dev/schemas/task.json');
  });

  it('has title set to Task', () => {
    expect(TaskSchema.title).toBe('Task');
  });

  it('has all required fields', () => {
    expect(TaskSchema.required).toEqual([
      'id',
      'source',
      'intent',
      'title',
      'priority',
      'status',
      'createdAt',
      'updatedAt',
      'metadata',
    ]);
  });

  it('source enum matches TaskSource type values', () => {
    expect(TaskSchema.properties.source.enum).toEqual([
      'email',
      'calendar',
      'social',
      'store',
      'manual',
    ]);
  });

  it('intent enum matches TaskIntent type values', () => {
    expect(TaskSchema.properties.intent.enum).toEqual([
      'reply',
      'schedule',
      'post',
      'fulfill',
      'escalate',
      'ignore',
      'unknown',
    ]);
  });

  it('priority enum matches TaskPriority type values', () => {
    expect(TaskSchema.properties.priority.enum).toEqual([
      'urgent',
      'high',
      'normal',
      'low',
    ]);
  });

  it('status enum matches TaskStatus type values', () => {
    expect(TaskSchema.properties.status.enum).toEqual([
      'pending',
      'planned',
      'running',
      'awaiting_approval',
      'completed',
      'failed',
    ]);
  });

  it('id property has uuid format', () => {
    expect(TaskSchema.properties.id.format).toBe('uuid');
  });

  it('createdAt and updatedAt have date-time format', () => {
    expect(TaskSchema.properties.createdAt.format).toBe('date-time');
    expect(TaskSchema.properties.updatedAt.format).toBe('date-time');
  });

  it('disallows additional properties', () => {
    expect(TaskSchema.additionalProperties).toBe(false);
  });
});

// ── ApprovalSchema ───────────────────────────────────────────────────────────

describe('ApprovalSchema', () => {
  it('has $schema set to draft-07', () => {
    expect(ApprovalSchema.$schema).toBe('http://json-schema.org/draft-07/schema#');
  });

  it('has correct $id', () => {
    expect(ApprovalSchema.$id).toBe('https://ai-ops.dev/schemas/approval.json');
  });

  it('has title set to Approval', () => {
    expect(ApprovalSchema.title).toBe('Approval');
  });

  it('has all required fields', () => {
    expect(ApprovalSchema.required).toEqual([
      'id',
      'actionId',
      'taskId',
      'risk',
      'reason',
      'preview',
      'requestedAt',
    ]);
  });

  it('risk enum matches RiskLevel type values', () => {
    expect(ApprovalSchema.properties.risk.enum).toEqual([
      'low',
      'medium',
      'high',
      'critical',
    ]);
  });

  it('decision enum matches ApprovalDecision type values', () => {
    expect(ApprovalSchema.properties.decision.enum).toEqual([
      'approved',
      'denied',
      'modified',
    ]);
  });

  it('requestedAt has date-time format', () => {
    expect(ApprovalSchema.properties.requestedAt.format).toBe('date-time');
  });

  it('ttlMs allows number or null', () => {
    expect(ApprovalSchema.properties.ttlMs.type).toEqual(['number', 'null']);
  });

  it('disallows additional properties', () => {
    expect(ApprovalSchema.additionalProperties).toBe(false);
  });
});

// ── ActionReceiptSchema ──────────────────────────────────────────────────────

describe('ActionReceiptSchema', () => {
  it('has $schema set to draft-07', () => {
    expect(ActionReceiptSchema.$schema).toBe('http://json-schema.org/draft-07/schema#');
  });

  it('has correct $id', () => {
    expect(ActionReceiptSchema.$id).toBe('https://ai-ops.dev/schemas/action-receipt.json');
  });

  it('has title set to ActionReceipt', () => {
    expect(ActionReceiptSchema.title).toBe('ActionReceipt');
  });

  it('has all required fields', () => {
    expect(ActionReceiptSchema.required).toEqual([
      'id',
      'actionId',
      'policyVersion',
      'cordDecision',
      'cordScore',
      'cordReasons',
      'input',
      'timestamp',
      'hash',
      'signature',
      'prevHash',
    ]);
  });

  it('cordScore has min 0 and max 99', () => {
    expect(ActionReceiptSchema.properties.cordScore.minimum).toBe(0);
    expect(ActionReceiptSchema.properties.cordScore.maximum).toBe(99);
  });

  it('cordReasons is an array of strings', () => {
    expect(ActionReceiptSchema.properties.cordReasons.type).toBe('array');
    expect(ActionReceiptSchema.properties.cordReasons.items).toEqual({ type: 'string' });
  });

  it('disallows additional properties', () => {
    expect(ActionReceiptSchema.additionalProperties).toBe(false);
  });
});

// ── WorkflowStepSchema ───────────────────────────────────────────────────────

describe('WorkflowStepSchema', () => {
  it('has $schema set to draft-07', () => {
    expect(WorkflowStepSchema.$schema).toBe('http://json-schema.org/draft-07/schema#');
  });

  it('has correct $id', () => {
    expect(WorkflowStepSchema.$id).toBe('https://ai-ops.dev/schemas/workflow-step.json');
  });

  it('has title set to WorkflowStep', () => {
    expect(WorkflowStepSchema.title).toBe('WorkflowStep');
  });

  it('has all required fields', () => {
    expect(WorkflowStepSchema.required).toEqual([
      'id',
      'connector',
      'operation',
      'input',
      'status',
    ]);
  });

  it('status enum matches StepStatus type values', () => {
    expect(WorkflowStepSchema.properties.status.enum).toEqual([
      'pending',
      'running',
      'completed',
      'failed',
      'blocked',
      'approved',
    ]);
  });

  it('cordDecision enum matches CordDecision type values', () => {
    expect(WorkflowStepSchema.properties.cordDecision.enum).toEqual([
      'ALLOW',
      'CONTAIN',
      'CHALLENGE',
      'BLOCK',
    ]);
  });

  it('cordScore has min 0 and max 99', () => {
    expect(WorkflowStepSchema.properties.cordScore.minimum).toBe(0);
    expect(WorkflowStepSchema.properties.cordScore.maximum).toBe(99);
  });

  it('disallows additional properties', () => {
    expect(WorkflowStepSchema.additionalProperties).toBe(false);
  });
});

// ── WorkflowRunSchema ────────────────────────────────────────────────────────

describe('WorkflowRunSchema', () => {
  it('has $schema set to draft-07', () => {
    expect(WorkflowRunSchema.$schema).toBe('http://json-schema.org/draft-07/schema#');
  });

  it('has correct $id', () => {
    expect(WorkflowRunSchema.$id).toBe('https://ai-ops.dev/schemas/workflow-run.json');
  });

  it('has title set to WorkflowRun', () => {
    expect(WorkflowRunSchema.title).toBe('WorkflowRun');
  });

  it('has all required fields', () => {
    expect(WorkflowRunSchema.required).toEqual([
      'id',
      'taskId',
      'workflowType',
      'steps',
      'state',
      'startedAt',
    ]);
  });

  it('state enum matches WorkflowState type values', () => {
    expect(WorkflowRunSchema.properties.state.enum).toEqual([
      'queued',
      'running',
      'paused',
      'completed',
      'failed',
    ]);
  });

  it('steps references WorkflowStep schema via $ref', () => {
    expect(WorkflowRunSchema.properties.steps.type).toBe('array');
    expect(WorkflowRunSchema.properties.steps.items).toEqual({
      $ref: 'https://ai-ops.dev/schemas/workflow-step.json',
    });
  });

  it('disallows additional properties', () => {
    expect(WorkflowRunSchema.additionalProperties).toBe(false);
  });
});

// ── SCHEMAS registry ─────────────────────────────────────────────────────────

describe('SCHEMAS registry', () => {
  it('maps Task to TaskSchema', () => {
    expect(SCHEMAS.Task).toBe(TaskSchema);
  });

  it('maps Approval to ApprovalSchema', () => {
    expect(SCHEMAS.Approval).toBe(ApprovalSchema);
  });

  it('maps ActionReceipt to ActionReceiptSchema', () => {
    expect(SCHEMAS.ActionReceipt).toBe(ActionReceiptSchema);
  });

  it('maps WorkflowStep to WorkflowStepSchema', () => {
    expect(SCHEMAS.WorkflowStep).toBe(WorkflowStepSchema);
  });

  it('maps WorkflowRun to WorkflowRunSchema', () => {
    expect(SCHEMAS.WorkflowRun).toBe(WorkflowRunSchema);
  });

  it('contains exactly 5 entries', () => {
    expect(Object.keys(SCHEMAS)).toHaveLength(5);
  });

  it('all schemas have $schema set to draft-07', () => {
    for (const [name, schema] of Object.entries(SCHEMAS)) {
      expect((schema as { $schema: string }).$schema).toBe(
        'http://json-schema.org/draft-07/schema#',
      );
    }
  });
});
