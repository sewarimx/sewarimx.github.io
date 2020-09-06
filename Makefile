#
# Current working directory
#
PWD=$(shell pwd)

#
# Defaults
#
src=build
from=master
target=gh-pages
message=Release: $(shell date)

#
# Templates
#
_src=src/$(patsubst js%,resources/scripts%,\
	$(patsubst css%,resources/styles%,\
	$(patsubst res%,resources%,\
	$(patsubst page%,pages%,$(NAME)))))
_path=$(patsubst %/,%,$(_src))
_basedir=$(dir $(_path))

#
# Directories
#
dirname=$(patsubst %/,%,$(_basedir))
filepath=$(patsubst $(_basedir),,$(_path))

#
# Environment vars
#
GIT_REVISION=$(shell git rev-parse --short=7 HEAD)
NODE_ENV=development

export NODE_ENV GIT_REVISION

#
# Targets
#
.PHONY: ? add rm dev test deps clean prune dist pages deploy

#
# Utils
#
define iif
	@(($1 > /dev/null 2>&1) && printf "\r* $2\n") || printf "\r* $3\n"
endef

#
# Input
#
ifeq ($(BODY),)
BODY := $(shell bash -c 'if test ! -t 0; then cat -; fi')
endif

#
# Validation
#
check_defined = $(strip $(foreach 1,$1, $(call __check_defined,$1,$(strip $(value 2)))))
__check_defined = $(if $(value $1),, $(error $2, e.g. $1=test))

#
# Display all targets in this file
#
?: Makefile
	@awk -F':.*?##' '/^[a-z\\%!:-]+:.*##/{gsub("%","*",$$1);gsub("\\\\",":*",$$1);printf "\033[36m%8s\033[0m %s\n",$$1,$$2}' $<
	@printf "\n  Examples:"
	@printf "\n    make add:page NAME=example.md BODY='# It works!'"
	@printf "\n    make rm:Dockerfile"
	@printf "\n    make clean dev"
	@printf "\n\n"

#
# Adding files to the project
#
add: ## Create files, scripts or resources
	@$(call check_defined, NAME, Missing file name)
	@$(call check_defined, BODY, Missing file content)
	@mkdir -p $(PWD)/$(dirname)
	@echo $(BODY) > $(PWD)/$(filepath)
	@printf "\r* File $(filepath) was created\n"

add\:%: ## Shortcut for adding files
	@make -s add NAME=$(subst :,/,$*)/$(NAME) BODY=$(BODY)

#
# Remove files from the project
#
rm: ## Remove **any** stuff from your workspace
	@$(call check_defined, NAME, Missing file name)
	@$(call iif,rm -r $(PWD)/$(filepath),File $(filepath) was deleted,Failed to delete $(filepath))
	@$(call iif,rmdir $(PWD)/$(dirname),Parent directory clear,Parent directory is not empty...)

rm\:%: ## Shortcut for removing files
	@make -s rm NAME=$(subst :,/,$*)/$(NAME)

#
# Development tasks
#
dev: deps ## Start development
	@npm run dev

#
# Testing tasks
#
test: deps ## Test for syntax issues
	@npm run check

#
# Build task
#
dist: deps ## Compile sources for production
	@NODE_ENV=production npm run dist -- -f

#
# Check dependencies
#
deps: ## Check for installed dependencies
	@(((ls node_modules | grep .) > /dev/null 2>&1) || npm i) || true

#
# Cleanup
#
clean: ## Remove cache and generated artifacts
	@$(call iif,rm -r $(src),Built artifacts were deleted,Artifacts already deleted)
	@$(call iif,unlink .tarima,Cache file was deleted,Cache file already deleted)

#
# Clean dependencies
#
prune: clean ## Remove all stuff from node_modules/*
	@printf "\r* Removing all dependencies... "
	@rm -rf node_modules/.{bin,cache}
	@rm -rf node_modules/*
	@echo "OK"

#
# GitHub Pages branch
#
pages: ## Fetch or create the target branch
	@(git fetch origin $(target) 2> /dev/null || (\
		git checkout --orphan $(target);\
		git rm -rf . > /dev/null;\
		git commit --allow-empty -m "initial commit";\
		git checkout $(from)))

#
# Deployment to GitHub Pages
#
deploy: pages ## Prepare and push changes on target branch
	@(mv $(src) .backup > /dev/null 2>&1) || true
	@(git worktree remove $(src) --force > /dev/null 2>&1) || true
	@(git worktree add $(src) $(target) && (cp -r .backup/* $(src) > /dev/null 2>&1)) || true
	@cd $(src) && git add . && git commit -m "$(message)" || true
	@(mv .backup $(src) > /dev/null 2>&1) || true
	@git push origin $(target) -f || true
