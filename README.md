# codemirror-indent-guides-plugin

## how to use

### first

```
import {EditorState, basicSetup} from "@codemirror/basic-setup"
import {EditorView, keymap} from "@codemirror/view"
import {indentWithTab} from "@codemirror/commands"
import {javascript} from "@codemirror/lang-javascript"
import {indentGuidesPlugin} from './index.ts'

const doc = `if (true) {
  console.log("okay")
} else {
  console.log("oh no")
}
`

new EditorView({
  state: EditorState.create({
    doc,
    extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      javascript(),
      ...indentGuidesPlugin
    ]
  }),
  parent: document.querySelector("#editor")
})
```
### then 
add css 
```
    .cm-tab {
      border-left: 1px solid #dfdcd0;
    }
    .cm-tab-active {
      border-left: 1px solid #8c8977;
    }

```
