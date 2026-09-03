import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ActivityEntry, Insight, Model, Policy, Projection, Proposal, Provider, Rule, TrafficClass,
} from '../domain/types';
import {
  INITIAL_CLASSES, INITIAL_POLICY, INITIAL_PROVIDERS, INITIAL_TOTAL_BUDGET_USD, seed,
} from '../data/initial';
import { project } from '../domain/cost';

export type Simulation = { rules: Rule[]; projection: Projection; at: string; label: string };

type State = {
  models: Model[];
  providers: Provider[];
  classes: TrafficClass[];
  policy: Policy;
  totalBudgetUsd: number;
  proposals: Proposal[];
  activity: ActivityEntry[];
  insights: Insight[];
  simulation: Simulation | null;
  seq: number;
};

type Actions = {
  logActivity: (e: Omit<ActivityEntry, 'id' | 'at'>) => void;
  setClassVolume: (classId: string, monthlyCalls: number) => void;
  setTotalBudget: (usd: number) => void;
  setProviderBudgetDirect: (providerId: string, usd: number) => void;
  applyRulesDirect: (rules: Rule[]) => void;
  createProposal: (p: Omit<Proposal, 'id' | 'createdAt' | 'status' | 'decidedAt' | 'decisionNote'>) => Proposal;
  decideProposal: (id: string, status: 'approved' | 'rejected', note: string | null) => Proposal | null;
  setSimulation: (s: Simulation | null) => void;
  pinInsight: (title: string, body: string) => Insight;
  resetDemo: () => void;
};

const initialState = (): State => ({
  models: seed.models,
  providers: INITIAL_PROVIDERS,
  classes: INITIAL_CLASSES,
  policy: INITIAL_POLICY,
  totalBudgetUsd: INITIAL_TOTAL_BUDGET_USD,
  proposals: [],
  activity: [],
  insights: [],
  simulation: null,
  seq: 0,
});

export const useSwitchboard = create<State & Actions>()(
  persist(
    (set, get) => ({
      ...initialState(),

      logActivity: (e) =>
        set((s) => ({
          seq: s.seq + 1,
          activity: [
            { ...e, id: `A-${s.seq + 1}`, at: new Date().toISOString() },
            ...s.activity,
          ].slice(0, 200),
        })),

      setClassVolume: (classId, monthlyCalls) =>
        set((s) => ({
          classes: s.classes.map((c) =>
            c.id === classId ? { ...c, monthlyCalls: Math.max(0, Math.round(monthlyCalls)) } : c,
          ),
        })),

      setTotalBudget: (usd) => set({ totalBudgetUsd: Math.max(0, usd) }),

      setProviderBudgetDirect: (providerId, usd) =>
        set((s) => ({
          providers: s.providers.map((p) =>
            p.id === providerId ? { ...p, monthlyBudgetUsd: Math.max(0, usd) } : p,
          ),
        })),

      applyRulesDirect: (rules) =>
        set((s) => {
          const next = new Map(s.policy.rules.map((r) => [r.classId, r]));
          for (const r of rules) next.set(r.classId, r);
          return {
            policy: { rules: Array.from(next.values()), updatedAt: new Date().toISOString() },
            simulation: null,
          };
        }),

      createProposal: (p) => {
        const s = get();
        const proposal: Proposal = {
          ...p,
          id: `P-${s.proposals.length + 1}`,
          createdAt: new Date().toISOString(),
          status: 'pending',
          decidedAt: null,
          decisionNote: null,
        };
        set({ proposals: [proposal, ...s.proposals] });
        return proposal;
      },

      decideProposal: (id, status, note) => {
        const s = get();
        const p = s.proposals.find((x) => x.id === id);
        if (!p || p.status !== 'pending') return null;
        const decided: Proposal = {
          ...p, status, decidedAt: new Date().toISOString(), decisionNote: note,
        };
        set({ proposals: s.proposals.map((x) => (x.id === id ? decided : x)) });

        if (status === 'approved') {
          if (p.kind === 'policy' && p.rules) get().applyRulesDirect(p.rules);
          if (p.kind === 'budget' && p.providerId && p.monthlyBudgetUsd !== null) {
            get().setProviderBudgetDirect(p.providerId, p.monthlyBudgetUsd);
          }
        }
        return decided;
      },

      setSimulation: (simulation) => set({ simulation }),

      pinInsight: (title, body) => {
        const s = get();
        const insight: Insight = {
          id: `I-${s.insights.length + 1}`, at: new Date().toISOString(), title, body,
        };
        set({ insights: [insight, ...s.insights].slice(0, 20) });
        return insight;
      },

      resetDemo: () => set(initialState()),
    }),
    {
      name: 'switchboard-v2',
      // models come from the bundled seed, never from storage
      partialize: (s) => ({
        providers: s.providers, classes: s.classes, policy: s.policy,
        totalBudgetUsd: s.totalBudgetUsd, proposals: s.proposals,
        activity: s.activity, insights: s.insights, seq: s.seq,
      }),
      merge: (persisted, current) => ({ ...current, ...(persisted as object) }),
    },
  ),
);

/** Current projection under the live policy. */
export const currentProjection = (): Projection => {
  const s = useSwitchboard.getState();
  return project(s.classes, s.policy, s.models);
};

/** Projection under a candidate rule set, without touching live state. */
export const candidateProjection = (rules: Rule[]): Projection => {
  const s = useSwitchboard.getState();
  const merged = new Map(s.policy.rules.map((r) => [r.classId, r]));
  for (const r of rules) merged.set(r.classId, r);
  return project(s.classes, { rules: Array.from(merged.values()), updatedAt: '' }, s.models);
};
