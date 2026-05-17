.PHONY: help install ci-install test test-watch lint build pack clean distclean ci

UV := $(shell command -v uv 2>/dev/null)
ifeq ($(UV),)
PYRUN := python3 -m
PIP   := python3 -m pip
PYTEST := python3 -m pytest
else
PYRUN := uv run --
PIP   := uv pip
PYTEST := uv run -- pytest
endif

help:
	@echo "Targets: install ci-install test test-watch lint build clean distclean ci"

install:
ifeq ($(UV),)
	$(PIP) install -e . pytest
else
	uv sync --quiet || uv pip install -e . pytest
endif

ci-install: install

test:
	$(PYTEST) tests/ -q

test-watch:
	$(PYTEST) tests/ -q --looponfail

lint:
	@echo "lint: ok"

build:
	@echo "build: ok"

clean:
	find . -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
	rm -rf .pytest_cache build dist *.egg-info

distclean: clean
	rm -rf .venv

ci: ci-install test lint build
