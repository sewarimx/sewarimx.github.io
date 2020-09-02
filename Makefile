# current working directory
PWD=$(shell pwd)

# defaults
src := build
from := master
target := gh-pages
message := Release: $(shell date)

# templates
_src=src/$(patsubst res%,resources%,$(patsubst page%,pages%,$*))
_dir=$(patsubst %/,%,$(_src)/$(NAME))
_base=$(dir $(_dir))

# directories
dirname=$(patsubst %/,%,$(_base))
filepath=$(patsubst $(_base),,$(_dir))

# environment vars
GIT_REVISION := $(shell git rev-parse --short=7 HEAD)
NODE_ENV := development

# export vars
export NODE_ENV GIT_REVISION

# targets
.PHONY: ? dev test dist clean deploy deps purge has_body

# utils
define iif
  @(($(1) > /dev/null 2>&1) && printf "\r* $(2)\n") || printf "\r* $(3)\n"
endef

# display all targets-with-help in this file
?: Makefile
	@(figlet plate! 2> /dev/null) || printf "\n  Welcome to plate!\n  -- get http://www.figlet.org/ to see a nice banner ;-)\n\n"
	@awk -F':.*?##' '/^[a-z\\%!:-]+:.*##/{gsub("%","*",$$1);gsub("\\\\",":*",$$1);printf "\033[36m%8s\033[0m %s\n",$$1,$$2}' $<
	@printf "\n  Examples:"
	@printf "\n    make add:page NAME=example.md BODY='# It works!'"
	@printf "\n    make rm:Dockerfile"
	@printf "\n    make clean dev"
	@printf "\n\n"

dev: deps ## Start development scripts
	@npm run dev

test: ## Lint to reduce mistakes and smells
	@npm run check

clean: ## Remove cache and generated artifacts
	@$(call iif,rm -r $(src),Built artifacts were deleted,Artifacts already deleted)
	@$(call iif,unlink .tarima,Cache file was deleted,Cache file already deleted)

pages: dist
	@(mv $(src) .backup > /dev/null 2>&1) || true
	@(git worktree remove $(src) --force > /dev/null 2>&1) || true
	@git worktree add $(src) $(target)
	@cp -r .backup/* $(src)
	@cd $(src) && git add . && git commit -m "$(message)" || true

deploy: pages ## Push built artifacts to github!
	@git push origin $(target) -f || true
	@(mv .backup $(src) > /dev/null 2>&1) || true

deps: ## Check for installed dependencies
	@(((ls node_modules | grep .) > /dev/null 2>&1) || npm i) || true

dist: deps ## Compile sources for production
	@NODE_ENV=production npm run dist -- -f

purge: clean ## Remove all from node_modules/*
	@printf "\r* Removing all dependencies... "
	@rm -rf node_modules/.{bin,cache}
	@rm -rf node_modules/*
	@echo "OK"

add\:%: ## Create files, scripts or resources
	@make -s name_not_$* has_body
	@mkdir -p $(dirname)
	@echo "$(BODY)" > $(PWD)/$(filepath)
	@printf "\r* File $(filepath) was created\n"

rm\:%: ## Remove **any** stuff from your workspace
	@make -s name_not_$*
	@$(call iif,rm -r $(PWD)/$(filepath),File $(filepath) was deleted,Failed to delete $(filepath))
	@$(call iif,rmdir $(PWD)/$(dirname),Parent directory clear,Parent directory is not empty...)

# input validations
has_body:
ifeq ($(BODY),)
	@echo "* Missing file contents, e.g. BODY=test" && exit 1
endif

name_not_%:
	@((echo $* $(NAME) | grep -vE '^(lib|page|res)$$') > /dev/null 2>&1) \
		|| (echo "* Missing file path, e.g. NAME=test" && exit 1)
