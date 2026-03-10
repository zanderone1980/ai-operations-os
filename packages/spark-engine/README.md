# @ai-ops/spark-engine

**Self-Perpetuating Adaptive Reasoning Kernel** — A closed feedback loop that makes CORD safety scoring learn from outcomes.

## The Spark

Most AI safety systems use static rules. SPARK closes the loop: **Predict → Act → Measure → Learn**.

```
Step arrives → Predictor predicts outcome → CORD scores (with learned weights)
                                                ↓
                                          Step executes
                                                ↓
           LearningCore compares ← OutcomeTracker measures
                    ↓
          WeightManager updates (bounded by SENTINEL)
```

## Core Modules

### Predictor
Before each step, predicts the CORD score, expected outcome, and confidence.

```typescript
import { Predictor } from '@ai-ops/spark-engine';

const predictor = new Predictor(sparkStore);
const prediction = predictor.predict(stepId, runId, 'gmail', 'send');
// { predictedScore: 35, predictedOutcome: 'success', confidence: 0.72 }
```

### OutcomeTracker
After execution, measures what actually happened.

```typescript
import { OutcomeTracker } from '@ai-ops/spark-engine';

const tracker = new OutcomeTracker(sparkStore);
const outcome = tracker.measure(step, runId, wasApproved);
// { actualOutcome: 'failure', signals: { succeeded: false, hasError: true } }
```

### LearningCore
Compares prediction to reality and adjusts weights.

```typescript
import { LearningCore } from '@ai-ops/spark-engine';

const core = new LearningCore(sparkStore);
const episode = core.learn(prediction, outcome);
// { adjustmentDirection: 'increase', reason: 'CORD scored 15 but action failed' }
```

### AdaptiveSafetyGate
Wraps CordSafetyGate with learned weight multipliers.

```typescript
import { AdaptiveSafetyGate } from '@ai-ops/spark-engine';

const gate = new AdaptiveSafetyGate(cordGate, weightManager);
const result = gate.evaluateAction('gmail', 'send', input);
// score adjusted by learned weight, decision may change
```

## Safety Bounds (SENTINEL)

- All weights bounded ±30% of base (0.70–1.30)
- **Destructive** and **financial** categories can NEVER decrease below 1.0
- Minimum 3 episodes before any learning occurs
- EMA smoothing (α=0.1) prevents oscillation

## License

MIT
