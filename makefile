PRESETS = postcss-import postcss-extend-rule postcss-advanced-variables postcss-preset-env postcss-atroot postcss-property-lookup postcss-nested autoprefixer

.PHONY: css
css:
	npx -- postcss source/css/source.scss --use $(PRESETS) --output source/css/typing.css

.PHONY: mincss
mincss:
	npx -- postcss source/css/source.scss --use $(PRESETS) cssnano --no-map --output source/css/typing.css

.PHONY: copy
copy:
	mkdir -p ../hexo-theme-unit-test/themes/typing
	cp -r ./layout ../hexo-theme-unit-test/themes/typing/
	cp -r ./source ../hexo-theme-unit-test/themes/typing/
	cp -r ./languages ../hexo-theme-unit-test/themes/typing/
	cp -r ./_config.yml ../hexo-theme-unit-test/themes/typing/


.PHONY: all
all:
	make css
	make copy
