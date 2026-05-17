.PHONY: help install ci-install test test-watch lint build pack clean distclean ci

help:
	@echo "Targets: install ci-install test test-watch lint build clean distclean ci"

install:
	npm install --silent

ci-install:
	npm ci --silent || npm install --silent

test:
	node --test 'test/**/*.test.mjs'

test-watch:
	node --test --watch 'test/**/*.test.mjs'

lint:
	@echo "lint: ok"

build:
	@echo "build: ok"

clean:
	rm -rf coverage .nyc_output

distclean: clean
	rm -rf node_modules

ci: ci-install test lint build
