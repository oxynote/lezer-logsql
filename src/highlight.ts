import type { NodePropSource } from "@lezer/common"
import { styleTags, tags } from "@lezer/highlight"

export const logsqlHighlighting: NodePropSource = styleTags({
	LineComment: tags.lineComment,
	String: tags.string,
	"Number Duration Time BucketSize": tags.number,
	FieldName: tags.propertyName,
	"VariableReference DynamicDurationPlaceholder": tags.special(
		tags.variableName,
	),
	PipeName: tags.keyword,
	Keyword: tags.modifier,
	FunctionName: tags.function(tags.variableName),
	LogicOperator: tags.logicOperator,
	OperatorKeyword: tags.operatorKeyword,
	'= "!=" =~ "!~" ~ < > <= >=': tags.compareOperator,
	// a star and a minus are operators only inside a math expression. In a
	// filter the star stands for any value and the minus for not.
	'MathBinary/+ MathBinary/- MathBinary/"*" MathBinary/"/" MathBinary/%':
		tags.arithmeticOperator,
	"MathBinary/^ MathBinary/& MathUnary/+ MathUnary/-": tags.arithmeticOperator,
	'NotFilter/"!" NotFilter/-': tags.logicOperator,
	"|": tags.operator,
	": , ;": tags.punctuation,
	"( )": tags.paren,
	"[ ]": tags.squareBracket,
	"{ }": tags.brace,
})
