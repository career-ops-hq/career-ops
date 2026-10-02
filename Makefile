git-tag-release:
	@branch=$$(git rev-parse --abbrev-ref HEAD); \
	test "$$branch" = main || (echo "tag from main, not $$branch" >&2 && exit 1); \
	latest_tag=$$(git tag -l 'v*' --sort=-v:refname | head -n 1); \
	echo "Latest tag is $$latest_tag"; \
	read -p "Enter new release tag (with a v e.g. v1.2.3): " new_tag; \
	git tag $$new_tag; \
	git push origin $$new_tag; \
	echo "Released new tag $$new_tag"
