'use strict';
// elementui-plus style warning bar
// {% warn <content> %}

hexo.extend.tag.register(
  'warn',
  (args, content) => `<div style="
    background-color: #fdf6ec;
    color: #e6a23c;
    margin-bottom: 20px;
    padding: 5px 10px;
    border-radius: 3px;
    font-size: 16px;
"
>
  <span>${args.join(' ')}</span>
</div>
`
);