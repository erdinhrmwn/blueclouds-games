# Project skills

Claude Code loads every skill in this folder for anyone working in this repo.

`rivet-actors` and `rivet-workflows` are copied unchanged from
[rivet-dev/skills](https://github.com/rivet-dev/skills) at commit
`5104e6ce9263e94f278af72063bb67ac776764b0` (2026-11-06). Rivet generates
them from its docs and from the examples in
[rivet-dev/rivet](https://github.com/rivet-dev/rivet) (Apache-2.0).
rivet-dev/skills itself ships no license file.

Do not edit these copies. To update, copy the same folders again from a
newer upstream commit and change the commit above.

`hono` and `hono-jsx` come from [honojs/skills](https://github.com/honojs/skills)
(MIT) at commit `e54ce51f6effaeb574ebd2629e89e086e14a2db3` (2026-10-15),
installed the way [hono.dev/docs/agents](https://hono.dev/docs/agents/) says:

```sh
gh skill install honojs/skills hono --agent claude-code --scope project
gh skill install honojs/skills hono-jsx --agent claude-code --scope project
```

Their frontmatter carries the source metadata, so `gh skill update` refreshes them.
