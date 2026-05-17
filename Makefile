.PHONY: help install test parity gate ci analyze dag slice run report resume clean

# Anchors — change paths in one place if the layout moves.
SKILL_DIR  := .agents/skills/agentteams
SCRIPTS    := $(SKILL_DIR)/scripts
MJS_DIR    := $(SCRIPTS)/mjs
PY_DIR     := $(SCRIPTS)/py
ASSETS_DIR := .agents/skills/agentteams-assets

# Runtime-selecting shim — picks mjs or py based on $AGENTTEAMS_RUNTIME
# (auto-detects if unset). Override with: make analyze AGENTTEAMS_RUNTIME=py
AGENTTEAMS := $(SCRIPTS)/bin/agentteams

PLAN   ?= $(ASSETS_DIR)/fixtures/plans/minimal-plan
BUDGET ?= conservative

help:
	@echo "AgentTeams root targets"
	@echo "  install   — install both runtimes ($(MJS_DIR), $(PY_DIR))"
	@echo "  test      — run mjs + py test suites"
	@echo "  parity    — assert mjs ↔ py CLI parity"
	@echo "  gate      — run plan-wide acceptance gate"
	@echo "  ci        — install + test + parity + gate"
	@echo "  analyze   — run agentteams analyze on PLAN"
	@echo "  dag       — run agentteams dag on PLAN"
	@echo "  slice     — run agentteams slice on PLAN (BUDGET=$(BUDGET))"
	@echo "  run       — run agentteams run on PLAN"
	@echo "  report    — run agentteams report on PLAN"
	@echo "  resume    — run agentteams resume on PLAN"
	@echo "  clean     — remove .ai-harness artifacts"

install:
	$(MAKE) -C $(MJS_DIR) install
	$(MAKE) -C $(PY_DIR) install

test:
	$(MAKE) -C $(MJS_DIR) test
	$(MAKE) -C $(PY_DIR) test

parity:
	node $(SCRIPTS)/parity.mjs

gate:
	node $(SCRIPTS)/acceptance-gate.mjs

ci: install test parity gate

analyze:
	$(AGENTTEAMS) analyze $(PLAN)

dag:
	$(AGENTTEAMS) dag $(PLAN)

slice:
	$(AGENTTEAMS) slice $(PLAN) --budget $(BUDGET)

run:
	$(AGENTTEAMS) run $(PLAN) --hitl hard --no-interactive

report:
	$(AGENTTEAMS) report $(PLAN)

resume:
	$(AGENTTEAMS) resume $(PLAN)

clean:
	find $(PLAN)/.ai-harness -depth -delete 2>/dev/null || true
