import * as t from '@babel/types';
import * as m from '@codemod/matchers';
import { Transform, constMemberExpression } from '../../ast-utils';

// https://github.com/babel/babel/pull/5791
// https://github.com/babel/babel/blob/cce807f1eb638ee3030112dc190cbee032760888/packages/babel-plugin-transform-template-literals/src/index.ts

// TODO: option ignoreToPrimitiveHint (uses `+` instead of concat)

function escape(str: string) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
}

function push(template: t.TemplateLiteral, value: t.Expression) {
  if (value.type === 'StringLiteral') {
    const lastQuasi = template.quasis.at(-1)!;
    lastQuasi.value.raw += escape(value.value);
  } else if (value.type === 'TemplateLiteral') {
    const lastQuasi = template.quasis.at(-1)!;
    const firstQuasi = value.quasis[0];
    lastQuasi.value.raw += firstQuasi.value.raw;
    template.expressions.push(...value.expressions);
    template.quasis.push(...value.quasis.slice(1));
  } else {
    template.expressions.push(value);
    template.quasis.push(t.templateElement({ raw: '' }));
  }
}

function unshift(template: t.TemplateLiteral, value: t.Expression) {
  if (value.type === 'StringLiteral') {
    const firstQuasi = template.quasis[0];
    firstQuasi.value.raw = escape(value.value) + firstQuasi.value.raw;
  } else if (value.type === 'TemplateLiteral') {
    const firstQuasi = template.quasis[0];
    firstQuasi.value.raw = value.quasis[0].value.raw + firstQuasi.value.raw;
    template.expressions.unshift(...value.expressions);
    template.quasis.unshift(...value.quasis.slice(0, -1));
  } else {
    template.expressions.unshift(value);
    template.quasis.unshift(t.templateElement({ raw: '' }));
  }
}

export default {
  name: 'template-literals',
  tags: ['unsafe'],
  visitor() {
    const concatMatcher: m.Matcher<t.CallExpression> = m.or(
      m.callExpression(
        constMemberExpression(
          m.or(
            m.stringLiteral(),
            m.matcher((node) => concatMatcher.match(node)),
          ),
          'concat',
        ),
        m.arrayOf(m.anyExpression()),
      ),
    );

    return {
      StringLiteral(path) {
        // Heuristic: source code most likely used a template literal if it contains multiple lines
        if (!/\n.*?\n/.test(path.node.value)) return;
        if (concatMatcher.match(path.parentPath.parent)) return;

        const raw = escape(path.node.value);
        const quasi = t.templateElement({ raw });
        path.replaceWith(t.templateLiteral([quasi], []));
        this.changes++;
      },
      BinaryExpression: {
        exit(path) {
          if (path.node.operator !== '+') return;

          if (t.isTemplateLiteral(path.node.left)) {
            push(path.node.left, path.node.right);
            path.replaceWith(path.node.left);
            this.changes++;
          } else if (
            t.isTemplateLiteral(path.node.right) &&
            t.isExpression(path.node.left)
          ) {
            unshift(path.node.right, path.node.left);
            path.replaceWith(path.node.right);
            this.changes++;
          }
        },
      },
      CallExpression: {
        exit(path) {
          if (
            concatMatcher.match(path.node) &&
            !concatMatcher.match(path.parentPath.parent)
          ) {
            const template = t.templateLiteral(
              [t.templateElement({ raw: '' })],
              [],
            );
            let current: t.Expression = path.node;
            while (current.type === 'CallExpression') {
              for (const arg of current.arguments.reverse()) {
                unshift(template, arg as t.Expression);
              }
              current = (current.callee as t.MemberExpression).object;
            }
            unshift(template, current);
            path.replaceWith(template);
            this.changes++;
          }
        },
      },
    };
  },
} satisfies Transform;
