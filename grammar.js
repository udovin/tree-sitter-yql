/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// ============================================================================
// Tree-sitter grammar for YTsaurus YQL
// https://ytsaurus.tech/docs/ru/yql/syntax
// ============================================================================

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Case-insensitive keyword: kw('SELECT') matches select, SELECT, SeLeCt …
 * Returns a RegExp that matches each letter in either case.
 */
function kw(word) {
  return alias(
    token(
      prec(
        1,
        new RegExp(
          word
            .split("")
            .map((c) =>
              /[a-zA-Z]/.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c,
            )
            .join(""),
        ),
      ),
    ),
    word,
  );
}

/** Comma-separated list — one or more */
function commaSep1(rule) {
  return seq(rule, repeat(seq(",", rule)));
}

/** Comma-separated list — zero or more */
function commaSep(rule) {
  return optional(commaSep1(rule));
}

// ---------------------------------------------------------------------------
// Operator precedence (higher = tighter)
// Faithfully follows the table at
// https://ytsaurus.tech/docs/ru/yql/syntax/expressions#operator-priority
// ---------------------------------------------------------------------------
const PREC = {
  LAMBDA: -1,
  OR: 1,
  AND: 2,
  XOR: 3,
  NOT: 4,
  IS: 5,
  COMPARE: 6, // =, ==, !=, <>, IN, IS DISTINCT
  ORDER: 7, // <, <=, >=, >
  BIT: 8, // <<, >>, |<<, >>|, |, ^, &
  COALESCE: 9, // ?? (right-assoc)
  PLUS: 10, // +, -
  TIMES: 11, // *, /, %
  CONCAT: 12, // ||
  UNARY: 13, // +x, -x, ~x, NOT x
  ACCESS: 14, // a.b, a[i], a()
  CAST: 15,
  BETWEEN: 6,
  LIKE: 6,
  IN: 6,
};

// ============================================================================
module.exports = grammar({
  name: "yql",

  // Whitespace and comments may appear between any two tokens
  extras: ($) => [/\s/, $.line_comment, $.block_comment],

  // The word token is used by tree-sitter for keyword extraction
  word: ($) => $.plain_identifier,

  externals: () => [],

  inline: ($) => [$._literal, $._table_or_subquery],

  conflicts: ($) => [
    // $name = expr  vs  $name (plain expression-statement)
    [$.named_expr_assignment],
    // _primary_expression (named_expression) vs named_expr_assignment
    [$._primary_expression, $.named_expr_assignment],
    // _primary_expression vs lambda_params (both can start with "(" named_expression)
    [$._primary_expression, $.lambda_params],
    // _primary_expression vs _argument (AS alias ambiguity in function args)
    [$._primary_expression, $._argument],
    // SELECT expr AS alias  vs  general expression
    [$.select_item],
    // _primary_expression vs select_item (identifier starting both)
    [$._primary_expression, $.select_item],
    // Parenthesized expression vs tuple literal vs subquery
    [$.parenthesized_expression, $.tuple_expression],
    // GROUP BY expr AS alias
    [$.group_by_item],
    // FLATTEN BY item aliasing
    [$.flatten_by_item],
    // WINDOW w AS (…)
    [$.window_definition],
    // function_call vs type_ctor (both identifier + "(")
    [$.function_call, $.type_ctor_call],
    // ambiguity between table_ref and expression starting with identifier
    [$.table_ref],
    // identifier vs table_ref (backtick_identifier / plain_identifier starting both)
    [$.identifier, $.table_ref],
    // identifier vs _table_ref_for_write
    [$.identifier, $._table_ref_for_write],
    // simple expression statement ambiguity
    [$.expression_statement],
    // DEFINE ACTION / SUBQUERY
    [$.define_action_statement],
    [$.define_subquery_statement],
    // pragma value forms
    [$.pragma_statement],
    // PROCESS / REDUCE source list
    [$.process_statement],
    [$.reduce_statement],
    // insert
    [$.insert_statement],
    // do_call inline action vs block
    [$.do_statement],
    // _argument vs do_statement / _do_call
    [$._argument, $.do_statement],
    [$._argument, $._do_call],
    // join clause
    [$.join_clause],

    // _table_or_subquery: named_expression with optional call + alias
    [$._table_or_subquery],
    // inline_action vs begin_end_do_statement (both start with BEGIN)
    [$.inline_action, $.begin_end_do_statement],
    // tuple_expression vs flatten_by_item
    [$.tuple_expression, $.flatten_by_item],
    // parenthesized_expression vs flatten_by_item
    [$.parenthesized_expression, $.flatten_by_item],
    // _select_core: parenthesized select_body ambiguity
    [$._select_core],
    // select_statement: DISCARD / UNION / ORDER BY lookahead
    [$.select_statement],
  ],

  supertypes: ($) => [$.statement, $.expression],

  // =========================================================================
  // Rules
  // =========================================================================
  rules: {
    // -----------------------------------------------------------------------
    // Entry point
    // -----------------------------------------------------------------------
    source_file: ($) =>
      seq(optional($.ansi_lexer_pragma), optional($._statement_list)),

    _statement_list: ($) =>
      seq($.statement, repeat(seq(";", $.statement)), optional(";")),

    ansi_lexer_pragma: () => "--!ansi_lexer",

    // -----------------------------------------------------------------------
    // Top-level statements
    // -----------------------------------------------------------------------
    statement: ($) =>
      choice(
        $.select_statement,
        $.insert_statement,
        $.replace_statement,
        $.create_table_statement,
        $.drop_table_statement,
        $.use_statement,
        $.pragma_statement,
        $.commit_statement,
        $.discard_statement,
        $.into_result_statement,
        $.declare_statement,
        $.define_action_statement,
        $.do_statement,
        $.begin_end_do_statement,
        $.evaluate_if_statement,
        $.evaluate_for_statement,
        $.define_subquery_statement,
        $.export_statement,
        $.import_statement,
        $.process_statement,
        $.reduce_statement,
        $.values_statement,
        $.named_expr_assignment,
        $.expression_statement,
      ),

    expression_statement: ($) => $.expression,

    // =======================================================================
    // COMMENTS
    // =======================================================================

    // Single-line comment: -- until end of line.
    // We must not match --!ansi_lexer or --+ (sql hints) as plain comments.
    line_comment: () => token(seq("--", /[^!+\r\n]?/, /[^\r\n]*/)),

    // Multi-line block comment: /* ... */
    block_comment: () => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),

    // =======================================================================
    // IDENTIFIERS
    // =======================================================================

    // Plain (unquoted) identifier.  Must not be a keyword — tree-sitter
    // handles this via the `word` property.
    plain_identifier: () => /[a-zA-Z_][a-zA-Z0-9_]*/,

    // Backtick-quoted identifier: `arbitrary/path`
    // Supports C-style escape sequences.
    backtick_identifier: () =>
      token(seq("`", repeat(choice(/[^`\\]/, seq("\\", /./))), "`")),

    identifier: ($) => choice($.plain_identifier, $.backtick_identifier),

    // Named expression: $foo, $_bar, $_
    named_expression: () => token(seq("$", /[a-zA-Z_][a-zA-Z0-9_]*/)),

    // =======================================================================
    // LITERALS
    // =======================================================================

    // ---- Integer literal ----
    // Decimal, hex (0x), octal (0o), binary (0b), with optional type suffix.
    integer_literal: () =>
      token(
        seq(
          choice(/0[xX][0-9a-fA-F]+/, /0[oO][0-7]+/, /0[bB][01]+/, /[0-9]+/),
          optional(
            choice(
              // Pg suffixes (multi-char first to avoid prefix match)
              /[pP][nN]/i,
              /[pP][bB]/i,
              /[pP][sS]/i,
              /[pP][iI]/i,
              // YQL suffixes
              /[uU][lL]/,
              /[uU][sS]/,
              /[uU][tT]/,
              /[uU]/,
              /[lL]/,
              /[sS]/,
              /[tT]/,
              /[pP]/,
            ),
          ),
        ),
      ),

    // ---- Float literal ----
    float_literal: () =>
      token(
        seq(
          choice(
            seq(
              choice(seq(/[0-9]+/, ".", /[0-9]*/), seq(".", /[0-9]+/)),
              optional(seq(/[eE]/, optional(/[+-]/), /[0-9]+/)),
            ),
            seq(/[0-9]+/, /[eE]/, optional(/[+-]/), /[0-9]+/),
          ),
          optional(
            choice(/[pP][nN]/i, /[pP][fF]4/i, /[pP][fF]8/i, /[pP]/, /[fF]/),
          ),
        ),
      ),

    // ---- String literals ----

    // Single-quoted with C-escapes + optional type suffix
    single_quoted_string: () =>
      token(
        seq(
          "'",
          repeat(choice(/[^'\\]/, seq("\\", /./))),
          "'",
          optional(
            choice(
              /[pP][tT]/,
              /[pP][vV]/,
              /[pP][bB]/,
              /[pP]/,
              /[uU]/,
              /[yY]/,
              /[jJ]/,
              /[sS]/,
            ),
          ),
        ),
      ),

    // Double-quoted (C++ mode) with C-escapes + optional type suffix
    double_quoted_string: () =>
      token(
        seq(
          '"',
          repeat(choice(/[^"\\]/, seq("\\", /./))),
          '"',
          optional(
            choice(
              /[pP][tT]/,
              /[pP][vV]/,
              /[pP][bB]/,
              /[pP]/,
              /[uU]/,
              /[yY]/,
              /[jJ]/,
              /[sS]/,
            ),
          ),
        ),
      ),

    // Multiline string: @@…@@  (double @@ inside is an escape)
    multiline_string: () =>
      token(
        seq(
          "@@",
          repeat(choice(/[^@]/, seq("@", /[^@]/))),
          "@@",
          optional(
            choice(
              /[pP][tT]/,
              /[pP][vV]/,
              /[pP][bB]/,
              /[pP]/,
              /[uU]/,
              /[yY]/,
              /[jJ]/,
              /[sS]/,
            ),
          ),
        ),
      ),

    string_literal: ($) =>
      choice(
        $.single_quoted_string,
        $.double_quoted_string,
        $.multiline_string,
      ),

    bool_literal: () => choice(kw("TRUE"), kw("FALSE")),

    null_literal: () => kw("NULL"),

    _literal: ($) =>
      choice(
        $.integer_literal,
        $.float_literal,
        $.string_literal,
        $.bool_literal,
        $.null_literal,
      ),

    // =======================================================================
    // TYPE EXPRESSIONS
    // =======================================================================

    type_expr: ($) =>
      choice(
        $.optional_type,
        $.list_type,
        $.dict_type,
        $.set_type,
        $.tuple_type,
        $.struct_type,
        $.variant_type,
        $.stream_type,
        $.callable_type,
        $.resource_type,
        $.tagged_type,
        $.enum_type,
        $.simple_type,
      ),

    simple_type: ($) =>
      seq(
        $.identifier,
        optional(
          seq(
            "(",
            commaSep1(choice($.integer_literal, $.string_literal, $.type_expr)),
            ")",
          ),
        ),
      ),

    optional_type: ($) =>
      choice(
        seq(kw("Optional"), "<", $.type_expr, ">"),
        // Shorthand: Type?
        prec.left(seq($.type_expr, "?")),
      ),

    list_type: ($) => seq(kw("List"), "<", $.type_expr, ">"),

    dict_type: ($) => seq(kw("Dict"), "<", $.type_expr, ",", $.type_expr, ">"),

    set_type: ($) => seq(kw("Set"), "<", $.type_expr, ">"),

    tuple_type: ($) => seq(kw("Tuple"), "<", commaSep($.type_expr), ">"),

    struct_type: ($) =>
      seq(
        kw("Struct"),
        "<",
        commaSep(seq(choice($.identifier, $.string_literal), ":", $.type_expr)),
        ">",
      ),

    variant_type: ($) => seq(kw("Variant"), "<", commaSep1($.type_expr), ">"),

    stream_type: ($) => seq(kw("Stream"), "<", $.type_expr, ">"),

    callable_type: ($) =>
      seq(
        kw("Callable"),
        "<",
        "(",
        commaSep($.type_expr),
        ")",
        "->",
        $.type_expr,
        ">",
      ),

    resource_type: ($) => seq(kw("Resource"), "<", $.string_literal, ">"),

    tagged_type: ($) =>
      seq(kw("Tagged"), "<", $.type_expr, ",", $.string_literal, ">"),

    enum_type: ($) => seq(kw("Enum"), "<", commaSep1($.string_literal), ">"),

    // =======================================================================
    // EXPRESSIONS
    // =======================================================================

    expression: ($) =>
      choice(
        $.unary_expression,
        $.binary_expression,
        $.in_expression,
        $.between_expression,
        $.like_expression,
        $.is_null_expression,
        $.is_distinct_from_expression,
        $.case_expression,
        $.cast_expression,
        $.bitcast_expression,
        $.exists_expression,
        $.lambda_expression,
        $.over_expression,
        $._primary_expression,
      ),

    _primary_expression: ($) =>
      choice(
        $._literal,
        $.named_expression,
        $.identifier,
        $.function_call,
        $.type_ctor_call,
        $.member_access,
        $.subscript_access,
        $.parenthesized_expression,
        $.tuple_expression,
        $.subquery_expression,
        $.struct_literal,
        $.list_literal,
        $.dict_literal,
        $.table_row_call,
        $.table_rows_call,
        $.grouping_call,
        $.empty_action_literal,
        $.asterisk,
      ),

    asterisk: () => "*",

    // ---- Parenthesized expression ----
    parenthesized_expression: ($) => seq("(", $.expression, ")"),

    // ---- Tuple expression: (a, b, c) ----
    tuple_expression: ($) =>
      seq("(", $.expression, ",", commaSep($.expression), optional(","), ")"),

    // ---- Subquery expression: (SELECT …) ----
    subquery_expression: ($) => seq("(", $.select_statement, ")"),

    // ---- Struct literal: <| k: v, … |> ----
    struct_literal: ($) =>
      seq(
        "<|",
        commaSep1(
          seq(choice($.identifier, $.string_literal), ":", $.expression),
        ),
        "|>",
      ),

    // ---- List literal: [a, b, c] ----
    list_literal: ($) => seq("[", commaSep($.expression), "]"),

    // ---- Dict literal: {k: v, …} ----
    dict_literal: ($) =>
      seq("{", commaSep(seq($.expression, ":", $.expression)), "}"),

    // ---- Function call ----
    function_call: ($) =>
      prec(
        PREC.ACCESS,
        seq(
          field(
            "function",
            choice(
              $.identifier,
              $.named_expression,
              seq($.identifier, "::", $.identifier),
            ),
          ),
          "(",
          optional($.argument_list),
          ")",
        ),
      ),

    argument_list: ($) =>
      seq($._argument, repeat(seq(",", $._argument)), optional(",")),

    _argument: ($) =>
      choice(
        seq($.expression, kw("AS"), $.identifier),
        seq(choice(kw("DISTINCT"), kw("ALL")), $.expression),
        $.expression,
        $.asterisk,
      ),

    // ---- Window function call: expr OVER w  or  expr OVER (window_spec) ----
    // This is modeled as a postfix operator on any expression (typically a
    // function_call), so tree-sitter doesn't need to duplicate function_call
    // internals.
    over_expression: ($) =>
      prec.left(
        PREC.ACCESS,
        seq(
          field("function", $.expression),
          kw("OVER"),
          field(
            "window",
            choice($.identifier, seq("(", optional($.window_spec), ")")),
          ),
        ),
      ),

    // ---- Special pseudo-functions ----
    table_row_call: () => seq(kw("TableRow"), "(", ")"),
    table_rows_call: () => seq(kw("TableRows"), "(", ")"),
    grouping_call: ($) =>
      seq(kw("GROUPING"), "(", commaSep1($.expression), ")"),
    empty_action_literal: () => seq(kw("EMPTY_ACTION"), "(", ")"),

    // Type constructor: PgInt4(expr), PgBool("true"), etc.
    type_ctor_call: ($) =>
      prec(
        PREC.ACCESS,
        seq(field("type", $.identifier), "(", commaSep1($.expression), ")"),
      ),

    // ---- Member access: e.field or e.0 ----
    member_access: ($) =>
      prec.left(
        PREC.ACCESS,
        seq(
          field("object", $.expression),
          ".",
          field("member", choice($.identifier, $.integer_literal)),
        ),
      ),

    // ---- Subscript access: e[key] ----
    subscript_access: ($) =>
      prec.left(
        PREC.ACCESS,
        seq(
          field("object", $.expression),
          "[",
          field("index", $.expression),
          "]",
        ),
      ),

    // ---- Unary operators ----
    unary_expression: ($) =>
      prec.right(
        PREC.UNARY,
        seq(
          field("operator", choice("+", "-", "~", kw("NOT"))),
          field("operand", $.expression),
        ),
      ),

    // ---- Binary operators ----
    binary_expression: ($) => {
      /** @param {number} p @param {RuleOrLiteral} op */
      const binLeft = (p, op) =>
        prec.left(
          p,
          seq(
            field("left", $.expression),
            field("operator", op),
            field("right", $.expression),
          ),
        );
      /** @param {number} p @param {RuleOrLiteral} op */
      const binRight = (p, op) =>
        prec.right(
          p,
          seq(
            field("left", $.expression),
            field("operator", op),
            field("right", $.expression),
          ),
        );

      return choice(
        binLeft(PREC.OR, kw("OR")),
        binLeft(PREC.AND, kw("AND")),
        binLeft(PREC.XOR, kw("XOR")),
        binLeft(PREC.COMPARE, choice("=", "==", "!=", "<>")),
        binLeft(PREC.ORDER, choice("<", "<=", ">=", ">")),
        binLeft(PREC.BIT, choice("&", "|", "^", "<<", ">>", "|<<", ">>|")),
        binRight(PREC.COALESCE, "??"),
        binLeft(PREC.PLUS, choice("+", "-")),
        binLeft(PREC.TIMES, choice("*", "/", "%")),
        binLeft(PREC.CONCAT, "||"),
      );
    },

    // ---- IN ----
    in_expression: ($) =>
      prec.left(
        PREC.IN,
        seq(
          field("left", $.expression),
          optional(kw("NOT")),
          kw("IN"),
          optional($.sql_hint),
          field(
            "right",
            choice(
              seq("(", commaSep1($.expression), ")"),
              $.subquery_expression,
              $.named_expression,
              $.function_call,
            ),
          ),
        ),
      ),

    // ---- BETWEEN ----
    between_expression: ($) =>
      prec.left(
        PREC.BETWEEN,
        seq(
          field("value", $.expression),
          optional(kw("NOT")),
          kw("BETWEEN"),
          optional(choice(kw("ASYMMETRIC"), kw("SYMMETRIC"))),
          field("low", $.expression),
          kw("AND"),
          field("high", $.expression),
        ),
      ),

    // ---- LIKE / ILIKE / REGEXP / RLIKE / MATCH ----
    like_expression: ($) =>
      prec.left(
        PREC.LIKE,
        seq(
          field("left", $.expression),
          optional(kw("NOT")),
          field(
            "operator",
            choice(
              kw("LIKE"),
              kw("ILIKE"),
              kw("REGEXP"),
              kw("RLIKE"),
              kw("MATCH"),
            ),
          ),
          field("pattern", $.expression),
          optional(seq(kw("ESCAPE"), $.string_literal)),
        ),
      ),

    // ---- IS [NOT] NULL ----
    is_null_expression: ($) =>
      prec.left(
        PREC.IS,
        seq(
          field("operand", $.expression),
          kw("IS"),
          optional(kw("NOT")),
          kw("NULL"),
        ),
      ),

    // ---- IS [NOT] DISTINCT FROM ----
    is_distinct_from_expression: ($) =>
      prec.left(
        PREC.IS,
        seq(
          field("left", $.expression),
          kw("IS"),
          optional(kw("NOT")),
          kw("DISTINCT"),
          kw("FROM"),
          field("right", $.expression),
        ),
      ),

    // ---- EXISTS ----
    exists_expression: ($) =>
      prec(PREC.UNARY, seq(kw("EXISTS"), "(", $.select_statement, ")")),

    // ---- CASE ----
    case_expression: ($) =>
      seq(
        kw("CASE"),
        optional(field("operand", $.expression)),
        repeat1($.when_clause),
        optional(seq(kw("ELSE"), field("default", $.expression))),
        kw("END"),
      ),

    when_clause: ($) =>
      seq(
        kw("WHEN"),
        field("condition", $.expression),
        kw("THEN"),
        field("result", $.expression),
      ),

    // ---- CAST / BITCAST ----
    cast_expression: ($) =>
      prec(
        PREC.CAST,
        seq(
          kw("CAST"),
          "(",
          field("value", $.expression),
          kw("AS"),
          field("type", $.type_expr),
          ")",
        ),
      ),

    bitcast_expression: ($) =>
      prec(
        PREC.CAST,
        seq(
          kw("BITCAST"),
          "(",
          field("value", $.expression),
          kw("AS"),
          field("type", $.type_expr),
          ")",
        ),
      ),

    // ---- Lambda ----
    lambda_expression: ($) =>
      prec(
        PREC.LAMBDA,
        seq(
          field("parameters", $.lambda_params),
          "->",
          field("body", choice(seq("(", $.expression, ")"), $.lambda_body)),
        ),
      ),

    lambda_params: ($) =>
      seq("(", commaSep(seq($.named_expression, optional("?"))), ")"),

    lambda_body: ($) =>
      seq(
        "{",
        repeat(seq($.named_expr_assignment, ";")),
        kw("RETURN"),
        $.expression,
        optional(";"),
        "}",
      ),

    // ---- SQL hints: /*+ Name(Value) */ ----
    sql_hint: ($) => seq("/*+", repeat($.hint_entry), "*/"),

    hint_entry: ($) =>
      seq(
        $.identifier,
        "(",
        repeat(
          choice(
            $.string_literal,
            $.identifier,
            $.integer_literal,
            $.float_literal,
          ),
        ),
        ")",
      ),

    // =======================================================================
    // NAMED EXPRESSION ASSIGNMENT
    // =======================================================================

    named_expr_assignment: ($) =>
      seq(
        choice(
          $.named_expression,
          seq($.named_expression, repeat1(seq(",", $.named_expression))),
        ),
        "=",
        $.expression,
      ),

    // =======================================================================
    // SELECT STATEMENT (Stage 3)
    // =======================================================================

    select_statement: ($) =>
      seq(
        optional(kw("DISCARD")),
        $._select_core,
        repeat(
          seq(
            choice(
              seq(kw("UNION"), optional(kw("ALL"))),
              seq(kw("INTERSECT"), optional(kw("ALL"))),
              seq(kw("EXCEPT"), optional(kw("ALL"))),
            ),
            $._select_core,
          ),
        ),
        optional($.order_by_clause),
        optional($.limit_clause),
        optional($.into_result_clause),
      ),

    _select_core: ($) => choice($.select_body, seq("(", $.select_body, ")")),

    select_body: ($) =>
      seq(
        kw("SELECT"),
        optional(choice(kw("DISTINCT"), kw("ALL"))),
        $.select_list,
        optional($.from_clause),
        optional($.flatten_clause),
        optional($.where_clause),
        optional($.group_by_clause),
        optional($.having_clause),
        optional($.window_clause),
      ),

    select_list: ($) => commaSep1($.select_item),

    select_item: ($) =>
      choice(
        $.asterisk,
        seq(choice($.identifier, $.named_expression), ".", $.asterisk),
        seq($.expression, optional(seq(optional(kw("AS")), $.identifier))),
      ),

    // ---- FROM ----
    from_clause: ($) =>
      seq(kw("FROM"), $._table_or_subquery, repeat($.join_clause)),

    _table_or_subquery: ($) =>
      choice(
        $.table_ref,
        seq(
          $.subquery_expression,
          optional(seq(optional(kw("AS")), field("alias", $.identifier))),
        ),
        seq(
          $.named_expression,
          optional(seq("(", commaSep($.expression), ")")),
          optional(seq(optional(kw("AS")), field("alias", $.identifier))),
        ),
      ),

    table_ref: ($) =>
      seq(
        optional(kw("ANY")),
        choice(
          $.backtick_identifier,
          seq($.identifier, ".", $.backtick_identifier),
          seq(
            $.identifier,
            ":",
            $.named_expression,
            ".",
            $.backtick_identifier,
          ),
          $.identifier,
          $.table_function,
          seq(kw("AS_TABLE"), "(", $.expression, ")"),
        ),
        optional(seq(kw("VIEW"), $.identifier)),
        optional($.with_table_settings),
        optional(seq(optional(kw("AS")), field("alias", $.identifier))),
        optional($.sample_clause),
      ),

    table_function: ($) =>
      seq(
        choice(
          kw("CONCAT"),
          kw("CONCAT_STRICT"),
          kw("EACH"),
          kw("EACH_STRICT"),
          kw("RANGE"),
          kw("RANGE_STRICT"),
          kw("FILTER"),
          kw("FILTER_STRICT"),
          kw("FOLDER"),
          kw("WalkFolders"),
        ),
        "(",
        commaSep($.expression),
        ")",
      ),

    with_table_settings: ($) =>
      seq(
        kw("WITH"),
        choice($.table_setting, seq("(", commaSep1($.table_setting), ")")),
      ),

    table_setting: ($) => seq($.identifier, optional(seq("=", $.expression))),

    sample_clause: ($) =>
      seq(
        choice(kw("SAMPLE"), kw("TABLESAMPLE")),
        optional(choice(kw("BERNOULLI"), kw("SYSTEM"))),
        "(",
        $.expression,
        ")",
        optional(seq(kw("REPEATABLE"), "(", $.expression, ")")),
      ),

    // ---- JOIN ----
    join_clause: ($) =>
      seq(
        optional($.join_type),
        kw("JOIN"),
        optional(kw("ANY")),
        $._table_or_subquery,
        optional(seq(kw("VIEW"), $.identifier)),
        optional(seq(optional(kw("AS")), field("alias", $.identifier))),
        optional($.join_constraint),
      ),

    join_type: () =>
      choice(
        kw("INNER"),
        seq(kw("LEFT"), optional(choice(kw("OUTER"), kw("SEMI"), kw("ONLY")))),
        seq(kw("RIGHT"), optional(choice(kw("OUTER"), kw("SEMI"), kw("ONLY")))),
        seq(kw("FULL"), optional(kw("OUTER"))),
        kw("CROSS"),
        kw("EXCLUSION"),
      ),

    join_constraint: ($) =>
      choice(
        seq(kw("ON"), $.expression),
        seq(kw("USING"), "(", commaSep1($.identifier), ")"),
      ),

    // ---- FLATTEN ----
    flatten_clause: ($) =>
      choice(
        seq(kw("FLATTEN"), kw("COLUMNS")),
        seq(
          kw("FLATTEN"),
          optional(choice(kw("LIST"), kw("DICT"), kw("OPTIONAL"))),
          kw("BY"),
          choice(
            $.flatten_by_item,
            seq("(", commaSep1($.flatten_by_item), ")"),
          ),
        ),
      ),

    flatten_by_item: ($) =>
      seq($.expression, optional(seq(kw("AS"), $.identifier))),

    // ---- WHERE ----
    where_clause: ($) => seq(kw("WHERE"), $.expression),

    // ---- GROUP BY ----
    group_by_clause: ($) =>
      seq(
        kw("GROUP"),
        optional($.sql_hint),
        kw("BY"),
        commaSep1($.group_by_item),
      ),

    group_by_item: ($) =>
      choice(
        $.rollup_clause,
        $.cube_clause,
        $.grouping_sets_clause,
        $.session_window_call,
        seq($.expression, optional(seq(kw("AS"), $.identifier))),
      ),

    rollup_clause: ($) => seq(kw("ROLLUP"), "(", commaSep1($.expression), ")"),

    cube_clause: ($) => seq(kw("CUBE"), "(", commaSep1($.expression), ")"),

    grouping_sets_clause: ($) =>
      seq(
        kw("GROUPING"),
        kw("SETS"),
        "(",
        commaSep1(seq("(", commaSep($.expression), ")")),
        ")",
      ),

    session_window_call: ($) =>
      seq(kw("SessionWindow"), "(", commaSep1($.expression), ")"),

    // ---- HAVING ----
    having_clause: ($) => seq(kw("HAVING"), $.expression),

    // ---- WINDOW ----
    window_clause: ($) => seq(kw("WINDOW"), commaSep1($.window_definition)),

    window_definition: ($) =>
      seq($.identifier, kw("AS"), "(", optional($.window_spec), ")"),

    window_spec: ($) =>
      choice(
        seq(
          $.partition_by_clause,
          optional($.window_order_by),
          optional($.frame_clause),
        ),
        seq($.window_order_by, optional($.frame_clause)),
        $.frame_clause,
      ),

    partition_by_clause: ($) =>
      seq(
        kw("PARTITION"),
        optional($.sql_hint),
        kw("BY"),
        commaSep1($.partition_item),
      ),

    partition_item: ($) =>
      seq($.expression, optional(seq(kw("AS"), $.identifier))),

    window_order_by: ($) =>
      seq(kw("ORDER"), kw("BY"), commaSep1($.order_by_item)),

    frame_clause: ($) =>
      seq(
        kw("ROWS"),
        choice(
          $.frame_bound,
          seq(kw("BETWEEN"), $.frame_bound, kw("AND"), $.frame_bound),
        ),
      ),

    frame_bound: ($) =>
      choice(
        seq(kw("UNBOUNDED"), kw("PRECEDING")),
        seq(kw("UNBOUNDED"), kw("FOLLOWING")),
        seq(kw("CURRENT"), kw("ROW")),
        seq($.integer_literal, kw("PRECEDING")),
        seq($.integer_literal, kw("FOLLOWING")),
      ),

    // ---- ORDER BY ----
    order_by_clause: ($) =>
      seq(
        choice(
          seq(kw("ORDER"), kw("BY")),
          seq(kw("ASSUME"), kw("ORDER"), kw("BY")),
        ),
        commaSep1($.order_by_item),
      ),

    order_by_item: ($) =>
      seq(
        $.expression,
        optional(choice(kw("ASC"), kw("DESC"))),
        optional(seq(kw("NULLS"), choice(kw("FIRST"), kw("LAST")))),
      ),

    // ---- LIMIT / OFFSET ----
    limit_clause: ($) =>
      seq(
        kw("LIMIT"),
        $.expression,
        optional(seq(choice(kw("OFFSET"), ","), $.expression)),
      ),

    // ---- INTO RESULT (suffix on SELECT) ----
    into_result_clause: ($) =>
      seq(kw("INTO"), kw("RESULT"), optional($.identifier)),

    // =======================================================================
    // DML & DDL STATEMENTS (Stage 5)
    // =======================================================================

    // ---- USE ----
    use_statement: ($) =>
      seq(
        kw("USE"),
        choice($.identifier, seq($.identifier, ":", $.named_expression)),
      ),

    // ---- PRAGMA ----
    pragma_statement: ($) =>
      seq(
        kw("PRAGMA"),
        optional(seq($.identifier, ".")),
        $.identifier,
        optional(
          choice(
            seq("=", $._pragma_value),
            seq("(", commaSep1($._pragma_value), ")"),
          ),
        ),
      ),

    _pragma_value: ($) => choice($.expression, kw("default")),

    // ---- DECLARE ----
    declare_statement: ($) =>
      seq(kw("DECLARE"), $.named_expression, kw("AS"), $.type_expr),

    // ---- COMMIT ----
    commit_statement: () => kw("COMMIT"),

    // ---- DISCARD (standalone) ----
    discard_statement: ($) => seq(kw("DISCARD"), $.select_statement),

    // ---- INTO RESULT (standalone) ----
    into_result_statement: ($) =>
      seq(kw("INTO"), kw("RESULT"), optional($.identifier), $.select_statement),

    // ---- VALUES (standalone) ----
    values_statement: ($) => seq(kw("VALUES"), commaSep1($.values_row)),

    values_row: ($) => seq("(", commaSep1($.expression), ")"),

    // ---- INSERT INTO ----
    insert_statement: ($) =>
      seq(
        kw("INSERT"),
        kw("INTO"),
        $._table_ref_for_write,
        optional($.with_table_settings),
        optional(seq("(", commaSep1($.identifier), ")")),
        choice($.values_statement, $.select_statement),
      ),

    _table_ref_for_write: ($) =>
      choice(
        $.backtick_identifier,
        seq($.identifier, ".", $.backtick_identifier),
        $.identifier,
        $.named_expression,
      ),

    // ---- REPLACE INTO ----
    replace_statement: ($) =>
      seq(
        kw("REPLACE"),
        kw("INTO"),
        $._table_ref_for_write,
        optional($.with_table_settings),
        optional(seq("(", commaSep1($.identifier), ")")),
        choice($.values_statement, $.select_statement),
      ),

    // ---- CREATE TABLE ----
    create_table_statement: ($) =>
      seq(
        kw("CREATE"),
        optional(kw("TEMPORARY")),
        kw("TABLE"),
        $._table_ref_for_write,
        optional(
          seq(
            "(",
            commaSep1($.column_definition),
            optional(seq(",", $.primary_key_definition)),
            ")",
          ),
        ),
        optional($.with_table_settings),
      ),

    column_definition: ($) =>
      seq($.identifier, $.type_expr, optional(seq(kw("NOT"), kw("NULL")))),

    primary_key_definition: ($) =>
      seq(kw("PRIMARY"), kw("KEY"), "(", commaSep1($.identifier), ")"),

    // ---- DROP TABLE ----
    drop_table_statement: ($) =>
      seq(
        kw("DROP"),
        kw("TABLE"),
        optional(seq(kw("IF"), kw("EXISTS"))),
        $._table_ref_for_write,
      ),

    // =======================================================================
    // ACTION / SUBQUERY / PROCESS / REDUCE / EXPORT / IMPORT / EVALUATE
    // (Stage 6)
    // =======================================================================

    // ---- DEFINE ACTION ... END DEFINE ----
    define_action_statement: ($) =>
      seq(
        kw("DEFINE"),
        kw("ACTION"),
        $.named_expression,
        "(",
        commaSep($.action_param),
        ")",
        kw("AS"),
        optional($._statement_list),
        kw("END"),
        kw("DEFINE"),
      ),

    action_param: ($) => seq($.named_expression, optional("?")),

    // ---- DEFINE SUBQUERY ... END DEFINE ----
    define_subquery_statement: ($) =>
      seq(
        kw("DEFINE"),
        kw("SUBQUERY"),
        $.named_expression,
        "(",
        commaSep($.action_param),
        ")",
        kw("AS"),
        optional($._statement_list),
        kw("END"),
        kw("DEFINE"),
      ),

    // ---- DO ----
    do_statement: ($) =>
      seq(
        kw("DO"),
        choice(
          seq(
            choice($.named_expression, $.function_call, $.identifier),
            "(",
            commaSep($.expression),
            ")",
          ),
          $.inline_action,
        ),
      ),

    inline_action: ($) =>
      seq(kw("BEGIN"), optional($._statement_list), kw("END"), kw("DO")),

    // ---- BEGIN ... END DO (anonymous action) ----
    begin_end_do_statement: ($) =>
      seq(
        optional(kw("DO")),
        kw("BEGIN"),
        optional($._statement_list),
        kw("END"),
        kw("DO"),
      ),

    // ---- EVALUATE IF ----
    evaluate_if_statement: ($) =>
      seq(
        kw("EVALUATE"),
        kw("IF"),
        $.expression,
        $._do_call,
        optional(seq(kw("ELSE"), $._do_call)),
      ),

    // ---- EVALUATE FOR ----
    evaluate_for_statement: ($) =>
      seq(
        kw("EVALUATE"),
        kw("FOR"),
        $.named_expression,
        kw("IN"),
        $.expression,
        $._do_call,
        optional(seq(kw("ELSE"), $._do_call)),
      ),

    _do_call: ($) =>
      choice(
        seq(
          kw("DO"),
          choice($.named_expression, $.function_call, $.identifier),
          "(",
          commaSep($.expression),
          ")",
        ),
        seq(kw("DO"), $.inline_action),
      ),

    // ---- EXPORT ----
    export_statement: ($) => seq(kw("EXPORT"), commaSep1($.named_expression)),

    // ---- IMPORT ----
    import_statement: ($) =>
      seq(
        kw("IMPORT"),
        $.identifier,
        kw("SYMBOLS"),
        commaSep1($.import_symbol),
      ),

    import_symbol: ($) =>
      seq($.named_expression, optional(seq(kw("AS"), $.named_expression))),

    // ---- PROCESS ----
    process_statement: ($) =>
      seq(
        kw("PROCESS"),
        commaSep1($._table_or_subquery),
        optional(
          seq(
            kw("USING"),
            choice(
              seq($.identifier, "::", $.identifier),
              $.named_expression,
              $.identifier,
            ),
            "(",
            commaSep($.expression),
            ")",
            optional(
              seq(
                kw("ASSUME"),
                kw("ORDER"),
                kw("BY"),
                commaSep1($.order_by_item),
              ),
            ),
          ),
        ),
      ),

    // ---- REDUCE ----
    reduce_statement: ($) =>
      seq(
        kw("REDUCE"),
        commaSep1($._table_or_subquery),
        optional(seq(kw("PRESORT"), commaSep1($.order_by_item))),
        kw("ON"),
        commaSep1($.expression),
        kw("USING"),
        optional(kw("ALL")),
        choice(
          seq($.identifier, "::", $.identifier),
          $.named_expression,
          $.identifier,
        ),
        "(",
        commaSep($.expression),
        ")",
        optional(
          seq(kw("ASSUME"), kw("ORDER"), kw("BY"), commaSep1($.order_by_item)),
        ),
      ),
  },
});
