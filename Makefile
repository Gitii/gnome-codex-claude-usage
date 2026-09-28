UUID      := codex-claude-usage@gitii.github.io
SRC       := $(UUID)
BUILD     := build
ZIP       := $(BUILD)/$(UUID).shell-extension.zip
EXT_DIR   := $(or $(XDG_DATA_HOME),$(HOME)/.local/share)/gnome-shell/extensions/$(UUID)

JS_FILES  := $(shell find $(SRC) -name '*.js')

.PHONY: all schemas check lint zip install uninstall clean test-nested test-providers

all: zip

schemas: $(SRC)/schemas/gschemas.compiled

$(SRC)/schemas/gschemas.compiled: $(SRC)/schemas/*.gschema.xml
	glib-compile-schemas --strict $(SRC)/schemas

check: schemas
	node --test test/*.test.mjs
	@for f in $(JS_FILES); do node --check "$$f" || exit 1; done
	@python3 -c "import json,sys; json.load(open('$(SRC)/metadata.json'))"
	@echo "syntax OK"

lint:
	npx --yes eslint@9 $(SRC)

zip: schemas
	mkdir -p $(BUILD)
	rm -f $(ZIP)
	cd $(SRC) && zip -qr ../$(ZIP) . -x '*.orig' -x '.*'
	@echo "wrote $(ZIP)"

install: schemas
	mkdir -p $(EXT_DIR)
	cp -r $(SRC)/. $(EXT_DIR)/
	@echo "Installed to $(EXT_DIR). Log out and back in (Wayland), then: gnome-extensions enable $(UUID)"

uninstall:
	gnome-extensions disable $(UUID) 2>/dev/null || true
	rm -rf $(EXT_DIR)

test-nested: schemas
	./scripts/test-nested.sh

test-providers:
	./scripts/test-providers.sh

clean:
	rm -rf $(BUILD) $(SRC)/schemas/gschemas.compiled
